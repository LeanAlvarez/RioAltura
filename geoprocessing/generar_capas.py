"""Generate flood-extent GeoJSON layers for the Río Uruguay at Colón.

Offline pipeline: clip a Copernicus GLO-30 DEM window around Colón, resample
it, flood-fill it per port-gauge level (connected to the river, base river
level discounted), classify depth into 3 classes, polygonize and simplify,
and write one GeoJSON per level plus an ``index.json`` manifest consumed by
the frontend map module.

Run with ``uv run --project geoprocessing python geoprocessing/generar_capas.py``.
See ``geoprocessing/README.md`` for details on calibration and size budget.
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import sys
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from affine import Affine
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.features import shapes
from rasterio.io import MemoryFile
from rasterio.merge import merge
from rasterio.transform import rowcol
from scipy import ndimage
from shapely.geometry import MultiPolygon, Polygon, mapping, shape
from shapely.ops import transform as shapely_transform
from shapely.ops import unary_union

logger = logging.getLogger("generar_capas")

# --- Domain constants (mirror backend/app/config/dominio.py) ---

CERO_IGN_DEFAULT_M = -0.26

# Mirrors CRECIDA_MAXIMA_OBSERVADA_M in backend/app/config/dominio.py (see the
# source citation there). Exposed in index.json only so the frontend can show the
# "escenario hipotético: nunca registrado en Colón" label above this height (spec
# 008, S4); it never affects which levels are generated.
CRECIDA_MAXIMA_OBSERVADA_M = 10.00

# --- Geographic constants ---

BBOX_INICIAL: tuple[float, float, float, float] = (-58.25, -32.30, -58.05, -32.15)
MARGEN_NS_DEG = 0.05
SEED_LONLAT: tuple[float, float] = (-58.11, -32.22)
SEED_RADIUS_M = 150.0
EXPAND_STEP_DEG = 0.05
MAX_EXPANSIONS_PER_SIDE = 4

# --- Level / flooding constants ---

NIVEL_MIN_M = 3.0
NIVEL_MAX_M = 20.0
# Three-tier step (spec 008, S1): 0.25 m up to and including STEP_SPLIT_M, 0.5 m
# between STEP_SPLIT_M and STEP_SPLIT_2_M, 1.0 m above STEP_SPLIT_2_M. The step never
# changes to fit the size budget (see S2): only simplification (tolerance, cleanup
# thresholds) may change for that.
STEP_SPLIT_M = 10.5
STEP_SPLIT_2_M = 13.0
STEP_BAJO_M = 0.25
STEP_MEDIO_M = 0.5
STEP_ALTO_M = 1.0
BASE_RIVER_LEVEL_MIN_M = 2.2
BASE_RIVER_MARGIN_M = 0.3

# Copernicus GLO-30 flattens water bodies to one constant per editing segment, so the
# river surface in the DEM is a patchwork of flat plateaus at different values (2.0 m at
# the port, 2.5 m upstream of the islands, ...). Only the plateau holding the seed falls
# under the base level; the others would show up as deep "new water" from 3.00 m on.
# Flat plateaus connected to the river and not far above the base level are therefore
# treated as normal river too.
FLAT_SEGMENT_MAX_ABOVE_BASE_M = 1.5
FLAT_SEGMENT_MIN_HA = 5.0
FLAT_SEGMENT_MAX_ROUNDS = 10
# Bilinear resampling blends the seam between two plateaus over ~1 source pixel, so a
# plateau's flat core sits a couple of (resampled) cells away from the river mask.
FLAT_SEGMENT_ADJACENCY_CELLS = 2

DEPTH_CLASSES: dict[int, str] = {
    1: "hasta 0,5 m",
    2: "0,5 a 1,5 m",
    3: "más de 1,5 m",
}

# --- Output / size-budget constants ---

# Roughly 1.5-2x the 10 m post-resample pixel size at this latitude (~11-15 m).
# A tolerance close to the pixel size is what actually shrinks output size: a much
# tighter tolerance barely reduces the per-pixel "staircase" vertices that dominate
# the vertex count once the mask is already cleaned (see clean_mask / --min-area-ha).
DEFAULT_TOLERANCE_DEG = 0.0002
DEFAULT_MAX_MB = 25.0
MAX_TOLERANCE_ATTEMPTS = 3
TOLERANCE_GROWTH_FACTOR = 1.5
DEFAULT_OUT_DIR = "frontend/public/capas"
DEFAULT_DATA_DIR = "geoprocessing/data"
DEFAULT_RESAMPLE_FACTOR = 3

# --- Mask cleanup: drop noise components / fill pinhole gaps before vectorizing ---

DEFAULT_MIN_AREA_HA = 0.1
DEFAULT_MIN_HOLE_HA = 0.2

LICENCIA_DEM = (
    "Copernicus DEM © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH "
    "2014-2018, provided under COPERNICUS by the European Union and ESA"
)


# --- Pure core functions (testable without any I/O) ---


def flood_mask(dem: np.ndarray, water_elev: float, seed: tuple[int, int]) -> np.ndarray:
    """Cells at or below ``water_elev`` that are 8-connected to ``seed``.

    Parameters
    ----------
    dem : np.ndarray
        Elevation grid.
    water_elev : float
        Water surface elevation, same units/datum as ``dem``.
    seed : tuple[int, int]
        (row, col) of the river seed cell.

    Returns
    -------
    np.ndarray
        Boolean mask, same shape as ``dem``.
    """
    candidate = dem <= water_elev
    structure = np.ones((3, 3), dtype=int)  # 8-connectivity
    labeled, _ = ndimage.label(candidate, structure=structure)
    seed_label = labeled[seed]
    if seed_label == 0:
        return np.zeros_like(candidate, dtype=bool)
    return labeled == seed_label


def new_water(
    dem: np.ndarray,
    level: float,
    base_mask: np.ndarray,
    cero_ign: float,
    seed: tuple[int, int],
) -> np.ndarray:
    """Flooded cells at port-gauge ``level`` minus the normal (base) river.

    Parameters
    ----------
    dem : np.ndarray
        Elevation grid.
    level : float
        Port gauge reading (m).
    base_mask : np.ndarray
        Mask of the normal river extent, to subtract.
    cero_ign : float
        Port gauge zero, m over the IGN datum.
    seed : tuple[int, int]
        (row, col) of the river seed cell.
    """
    water_elev = level + cero_ign
    flooded = flood_mask(dem, water_elev, seed)
    return flooded & ~base_mask


def classify_depth(dem: np.ndarray, mask: np.ndarray, water_elev: float) -> np.ndarray:
    """Classify flooded cells into 3 depth classes.

    Class 1: depth <= 0.5 m. Class 2: 0.5 m < depth <= 1.5 m. Class 3: depth > 1.5 m.
    Cells outside ``mask`` are 0.
    """
    depth = water_elev - dem
    classes = np.zeros(dem.shape, dtype=np.uint8)
    classes[mask & (depth <= 0.5)] = 1
    classes[mask & (depth > 0.5) & (depth <= 1.5)] = 2
    classes[mask & (depth > 1.5)] = 3
    return classes


def edge_contact(mask: np.ndarray) -> dict[str, bool]:
    """Whether ``mask`` touches each side of the grid (north-up raster: row 0 = north)."""
    return {
        "norte": bool(mask[0, :].any()),
        "sur": bool(mask[-1, :].any()),
        "oeste": bool(mask[:, 0].any()),
        "este": bool(mask[:, -1].any()),
    }


def hectares(mask: np.ndarray, cell_area_m2: float) -> float:
    """Flooded area in hectares, rounded to 1 decimal."""
    return round(float(mask.sum()) * cell_area_m2 / 10_000.0, 1)


def level_filename(level: float) -> str:
    """Level (m) to output filename, e.g. 3.0 -> 'h_0300.geojson', 5.75 -> 'h_0575.geojson'."""
    return f"h_{round(level * 100):04d}.geojson"


def _frange_cents(start_cents: int, end_cents: int, step_cents: int) -> list[int]:
    return list(range(start_cents, end_cents + 1, step_cents))


def plan_levels(
    step_policy: float | dict[str, float],
    min_level: float = NIVEL_MIN_M,
    max_level: float = NIVEL_MAX_M,
    split_level: float = STEP_SPLIT_M,
    split_level_2: float = STEP_SPLIT_2_M,
) -> list[float]:
    """Build the sorted list of port-gauge levels to generate.

    ``step_policy`` is either a single step in metres (uniform) or a dict with
    keys ``hasta_1050`` (step up to and including ``split_level``), ``sobre_1050``
    (step strictly between ``split_level`` and ``split_level_2``, required whenever
    ``sobre_1050``'s tier is reachable) and ``sobre_13`` (step strictly above
    ``split_level_2``, optional: omitting it stops the level set at
    ``min(split_level_2, max_level)``, which is what the two-tier policy used
    before spec 008 relied on).
    """
    min_cents = round(min_level * 100)
    max_cents = round(max_level * 100)
    split_cents = round(split_level * 100)
    split2_cents = round(split_level_2 * 100)
    if isinstance(step_policy, dict):
        step_low_cents = round(step_policy["hasta_1050"] * 100)
        levels_cents = _frange_cents(min_cents, min(split_cents, max_cents), step_low_cents)
        if "sobre_1050" in step_policy and split_cents < max_cents:
            step_mid_cents = round(step_policy["sobre_1050"] * 100)
            mid_end_cents = min(split2_cents, max_cents)
            levels_cents += _frange_cents(
                split_cents + step_mid_cents, mid_end_cents, step_mid_cents
            )
        if "sobre_13" in step_policy and split2_cents < max_cents:
            step_high_cents = round(step_policy["sobre_13"] * 100)
            levels_cents += _frange_cents(
                split2_cents + step_high_cents, max_cents, step_high_cents
            )
    else:
        step_cents = round(step_policy * 100)
        levels_cents = _frange_cents(min_cents, max_cents, step_cents)
    return [cents / 100 for cents in levels_cents]


# Fixed three-tier step mandated by spec 008 (S1): 0.25 m up to 10.50 m, 0.5 m up to
# 13.00 m, 1.0 m up to 20.00 m. Unlike the two-tier policy it replaces, this never
# changes to fit the size budget (S2): only the simplification tolerance and cleanup
# thresholds may grow for that, never the level range or step.
DEFAULT_STEP_POLICY: dict[str, float] = {
    "hasta_1050": STEP_BAJO_M,
    "sobre_1050": STEP_MEDIO_M,
    "sobre_13": STEP_ALTO_M,
}


def round_bbox(bbox: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
    """Round to 4 decimals so 0.05° steps do not accumulate float noise."""
    west, south, east, north = bbox
    return (round(west, 4), round(south, 4), round(east, 4), round(north, 4))


def expand_bbox(
    bbox: tuple[float, float, float, float],
    sides: dict[str, bool],
    step: float = EXPAND_STEP_DEG,
) -> tuple[float, float, float, float]:
    """Move the west and/or east edge of ``bbox`` outward. North/south never move."""
    west, south, east, north = bbox
    if sides.get("oeste"):
        west -= step
    if sides.get("este"):
        east += step
    return round_bbox((west, south, east, north))


def sanitize_dem(array: np.ndarray, transform: Affine) -> tuple[np.ndarray, Affine]:
    """Drop empty (all-zero) edge rows/columns and mark remaining zeros as NaN.

    Merging tiles with ``bounds`` exactly on a tile edge can yield one extra
    column filled with 0; inland, 0 m is never a real elevation here, and a
    0 column would act as a fake channel along the bbox edge. NaN cells never
    compare below the water level, so they are never flooded.
    """
    data = array.astype(np.float32, copy=True)
    top = 0
    while data.shape[0] > 1 and not np.any(data[0]):
        data = data[1:]
        top += 1
    while data.shape[0] > 1 and not np.any(data[-1]):
        data = data[:-1]
    left = 0
    while data.shape[1] > 1 and not np.any(data[:, 0]):
        data = data[:, 1:]
        left += 1
    while data.shape[1] > 1 and not np.any(data[:, -1]):
        data = data[:, :-1]
    data[data == 0] = np.nan
    return data, transform * Affine.translation(left, top)


def cell_area_m2(pixel_width_deg: float, pixel_height_deg: float, lat_centre: float) -> float:
    """Cell area in m² from the pixel size in degrees at latitude ``lat_centre``."""
    lon_m_per_deg = 111_320.0 * math.cos(math.radians(lat_centre))
    lat_m_per_deg = 110_540.0
    width_m = abs(pixel_width_deg) * lon_m_per_deg
    height_m = abs(pixel_height_deg) * lat_m_per_deg
    return width_m * height_m


def base_river_level(dem_at_seed: float, cero_ign: float) -> float:
    """Water elevation (m) of the normal, non-flooded river."""
    return max(BASE_RIVER_LEVEL_MIN_M + cero_ign, dem_at_seed + BASE_RIVER_MARGIN_M)


def flat_segments(dem: np.ndarray, max_elev: float) -> np.ndarray:
    """Cells inside a perfectly flat 3x3 neighbourhood below ``max_elev``.

    Water bodies in the Copernicus DEM are flattened to a constant, so a zero
    local range is a reliable signature of a water plateau; NaN cells never
    qualify.
    """
    local_range = ndimage.maximum_filter(dem, 3) - ndimage.minimum_filter(dem, 3)
    with np.errstate(invalid="ignore"):
        return (local_range == 0) & (dem < max_elev)


def base_river_mask(
    dem: np.ndarray,
    base_level: float,
    seed: tuple[int, int],
    cell_area_m2: float,
    max_above_base: float = FLAT_SEGMENT_MAX_ABOVE_BASE_M,
    min_segment_ha: float = FLAT_SEGMENT_MIN_HA,
    adjacency_cells: int = FLAT_SEGMENT_ADJACENCY_CELLS,
) -> tuple[np.ndarray, int]:
    """Normal river: seed-connected cells under ``base_level`` plus adjacent flat plateaus.

    Flat water plateaus (see :func:`flat_segments`) at most ``max_above_base``
    metres above ``base_level``, of at least ``min_segment_ha`` hectares and
    within ``adjacency_cells`` cells of the river already found are absorbed,
    repeatedly, until no new plateau touches the river. Returns the mask and
    the number of plateaus absorbed.
    """
    structure = np.ones((3, 3), dtype=int)
    river = flood_mask(dem, base_level, seed)
    candidates = flat_segments(dem, base_level + max_above_base) & ~river
    min_cells = (min_segment_ha * 10_000.0) / cell_area_m2
    labeled, count = ndimage.label(candidates, structure=structure)
    if count == 0:
        return river, 0
    sizes = ndimage.sum(candidates, labeled, index=np.arange(1, count + 1))
    big_enough = {int(i) + 1 for i in np.flatnonzero(sizes >= min_cells)}
    absorbed = 0
    for _ in range(FLAT_SEGMENT_MAX_ROUNDS):
        near_river = ndimage.binary_dilation(river, structure, iterations=adjacency_cells)
        touching = set(np.unique(labeled[near_river]).tolist())
        touching.discard(0)
        new_labels = (touching & big_enough) - {0}
        if not new_labels:
            break
        river = river | np.isin(labeled, list(new_labels))
        big_enough -= new_labels
        absorbed += len(new_labels)
    if absorbed:
        # Close the thin seam of blended cells left between the river and each absorbed
        # plateau, so it does not surface as a hairline of "new water" at low levels.
        # Padding with the edge values keeps the closing from eroding the array border.
        pad = adjacency_cells
        padded = np.pad(river, pad, mode="edge")
        closed = ndimage.binary_closing(padded, structure, iterations=adjacency_cells)
        river = closed[pad:-pad, pad:-pad]
    return river, absorbed


def locate_seed(
    dem: np.ndarray,
    row: int,
    col: int,
    radius_rows: int,
    radius_cols: int,
) -> tuple[int, int]:
    """Lowest cell within a rectangular window around (row, col)."""
    r0, r1 = max(0, row - radius_rows), min(dem.shape[0], row + radius_rows + 1)
    c0, c1 = max(0, col - radius_cols), min(dem.shape[1], col + radius_cols + 1)
    window = dem[r0:r1, c0:c1]
    local_row, local_col = np.unravel_index(np.nanargmin(window), window.shape)
    return (r0 + int(local_row), c0 + int(local_col))


def clean_mask(
    mask: np.ndarray,
    cell_area_m2: float,
    min_area_ha: float = 0.0,
    min_hole_ha: float = 0.0,
) -> np.ndarray:
    """Remove small connected components and fill small enclosed holes.

    Both operations use 8-connectivity, matching ``flood_mask``. This keeps
    the polygonized output from fragmenting into thousands of tiny rasterio
    ``shapes()`` pieces (an 8-connected flood fill can leave diagonal-only
    slivers and pinholes that a 4-connectivity vectorizer splits apart).

    Parameters
    ----------
    mask : np.ndarray
        Boolean mask to clean.
    cell_area_m2 : float
        Area of one cell, m².
    min_area_ha : float
        Connected components smaller than this (hectares) are removed.
    min_hole_ha : float
        Enclosed background components smaller than this (hectares), that do
        not touch the array border, are filled in.
    """
    if min_area_ha <= 0 and min_hole_ha <= 0:
        return mask
    structure = np.ones((3, 3), dtype=int)  # 8-connectivity
    cleaned = mask.copy()

    if min_area_ha > 0:
        labeled, count = ndimage.label(cleaned, structure=structure)
        if count > 0:
            min_cells = (min_area_ha * 10_000.0) / cell_area_m2
            sizes = ndimage.sum(cleaned, labeled, index=np.arange(1, count + 1))
            small_labels = np.flatnonzero(sizes < min_cells) + 1
            if small_labels.size:
                cleaned[np.isin(labeled, small_labels)] = False

    if min_hole_ha > 0:
        inverse = ~cleaned
        labeled_inv, count_inv = ndimage.label(inverse, structure=structure)
        if count_inv > 0:
            border_labels = (
                set(labeled_inv[0, :].tolist())
                | set(labeled_inv[-1, :].tolist())
                | set(labeled_inv[:, 0].tolist())
                | set(labeled_inv[:, -1].tolist())
            )
            border_labels.discard(0)
            min_cells = (min_hole_ha * 10_000.0) / cell_area_m2
            sizes_inv = ndimage.sum(inverse, labeled_inv, index=np.arange(1, count_inv + 1))
            for label_id in range(1, count_inv + 1):
                if label_id in border_labels:
                    continue
                if sizes_inv[label_id - 1] < min_cells:
                    cleaned[labeled_inv == label_id] = True

    return cleaned


# --- DEM download / caching (I/O) ---


def dem_tile_id(lat: int, lon: int) -> str:
    """Copernicus DSM tile id for the 1x1 degree cell whose SW corner is (lat, lon)."""
    lat_hem = "S" if lat < 0 else "N"
    lon_hem = "W" if lon < 0 else "E"
    return f"{lat_hem}{abs(lat):02d}_00_{lon_hem}{abs(lon):03d}_00"


def dem_tile_url(lat: int, lon: int) -> str:
    """Public S3 URL of the Copernicus GLO-30 COG tile covering (lat, lon)."""
    name = f"Copernicus_DSM_COG_10_{dem_tile_id(lat, lon)}_DEM"
    return f"https://copernicus-dem-30m.s3.amazonaws.com/{name}/{name}.tif"


def tiles_for_bbox(bbox: tuple[float, float, float, float]) -> list[tuple[int, int]]:
    """1x1 degree tile SW corners (lat, lon) intersecting ``bbox``."""
    west, south, east, north = bbox
    lat_start, lat_end = math.floor(south), math.ceil(north)
    lon_start, lon_end = math.floor(west), math.ceil(east)
    return [(lat, lon) for lat in range(lat_start, lat_end) for lon in range(lon_start, lon_end)]


def bbox_slug(bbox: tuple[float, float, float, float]) -> str:
    """Filesystem-safe slug identifying a bbox, for the DEM cache filename."""

    def fmt(value: float) -> str:
        return f"{value:.4f}".replace("-", "m").replace(".", "p")

    return "_".join(fmt(v) for v in bbox)


def dem_cache_path(data_dir: Path, bbox: tuple[float, float, float, float]) -> Path:
    return data_dir / f"dem_{bbox_slug(bbox)}.tif"


def _write_geotiff(path: Path, array: np.ndarray, transform: Affine, crs: CRS | None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        height=array.shape[0],
        width=array.shape[1],
        count=1,
        dtype=array.dtype,
        crs=crs,
        transform=transform,
    ) as dst:
        dst.write(array, 1)


def load_dem(
    bbox: tuple[float, float, float, float],
    data_dir: Path,
    dem_override: Path | None,
) -> tuple[np.ndarray, Affine, CRS | None]:
    """Load the DEM window for ``bbox``, from ``dem_override``, cache, or network."""
    if dem_override is not None:
        logger.info("Using local DEM override: %s", dem_override)
        with rasterio.open(dem_override) as ds:
            return (*sanitize_dem(ds.read(1), ds.transform), ds.crs)

    cache_path = dem_cache_path(data_dir, bbox)
    if cache_path.exists():
        logger.info("Using cached DEM window: %s", cache_path)
        with rasterio.open(cache_path) as ds:
            return (*sanitize_dem(ds.read(1), ds.transform), ds.crs)

    tiles = tiles_for_bbox(bbox)
    urls = [dem_tile_url(lat, lon) for lat, lon in tiles]
    logger.info("Downloading DEM window (%d tile(s)): %s", len(urls), urls)
    datasets = [rasterio.open(f"/vsicurl/{url}") for url in urls]
    try:
        crs = datasets[0].crs
        mosaic, out_transform = merge(datasets, bounds=bbox)
    finally:
        for ds in datasets:
            ds.close()
    array = mosaic[0]
    _write_geotiff(cache_path, array, out_transform, crs)
    logger.info("Cached clipped DEM: %s", cache_path)
    return (*sanitize_dem(array, out_transform), crs)


def resample_bilinear(
    array: np.ndarray, transform: Affine, crs: CRS | None, factor: int
) -> tuple[np.ndarray, Affine]:
    """Upsample ``array`` by ``factor`` with bilinear resampling."""
    if factor <= 1:
        return array, transform
    height, width = array.shape
    new_height, new_width = height * factor, width * factor
    new_transform = transform * Affine.scale(1 / factor, 1 / factor)
    with MemoryFile() as memfile:
        with memfile.open(
            driver="GTiff",
            height=height,
            width=width,
            count=1,
            dtype=array.dtype,
            crs=crs,
            transform=transform,
        ) as ds:
            ds.write(array, 1)
        with memfile.open() as ds:
            data = ds.read(1, out_shape=(new_height, new_width), resampling=Resampling.bilinear)
    return data.astype(np.float32), new_transform


# --- Polygonization (I/O-adjacent, uses rasterio/shapely) ---


def _round_coords(geom: Any, decimals: int) -> Any:
    def _round_xy(x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        return np.round(x, decimals), np.round(y, decimals)

    return shapely_transform(_round_xy, geom)


def _drop_small_parts(geom: Any, min_area_deg2: float, min_hole_area_deg2: float) -> Any | None:
    """Belt-and-braces: drop tiny polygon members and fill tiny interior rings.

    The mask is already cleaned with :func:`clean_mask` before polygonizing;
    this only catches slivers introduced by ``simplify``.
    """
    polys = list(geom.geoms) if geom.geom_type == "MultiPolygon" else [geom]
    kept: list[Polygon] = []
    for poly in polys:
        if min_area_deg2 > 0 and poly.area < min_area_deg2:
            continue
        interiors = poly.interiors
        if min_hole_area_deg2 > 0:
            interiors = [ring for ring in interiors if Polygon(ring).area >= min_hole_area_deg2]
        kept.append(Polygon(poly.exterior, interiors))
    if not kept:
        return None
    return kept[0] if len(kept) == 1 else MultiPolygon(kept)


def polygonize_level(
    dem: np.ndarray,
    mask: np.ndarray,
    transform: Affine,
    water_elev: float,
    tolerance: float,
    min_area_deg2: float = 0.0,
    min_hole_area_deg2: float = 0.0,
) -> list[dict[str, Any]]:
    """Vectorize ``mask`` into simplified GeoJSON features, one per depth class.

    Uses 8-connectivity in ``rasterio.features.shapes`` to match the
    8-connected flood fill; with the default 4-connectivity, diagonally
    touching cells from the fill are vectorized as separate tiny polygons,
    exploding the feature count and output size.
    """
    classes = classify_depth(dem, mask, water_elev)
    features: list[dict[str, Any]] = []
    for clase, etiqueta in DEPTH_CLASSES.items():
        class_mask = classes == clase
        if not class_mask.any():
            continue
        polygons = [
            shape(geom)
            for geom, value in shapes(
                class_mask.astype(np.uint8),
                mask=class_mask,
                transform=transform,
                connectivity=8,
            )
            if value == 1
        ]
        if not polygons:
            continue
        merged = unary_union(polygons)
        simplified = merged.simplify(tolerance, preserve_topology=True)
        if simplified.is_empty:
            continue
        simplified = _round_coords(simplified, 5)
        if simplified.geom_type not in ("Polygon", "MultiPolygon"):
            continue
        simplified = _drop_small_parts(simplified, min_area_deg2, min_hole_area_deg2)
        if simplified is None or simplified.is_empty:
            continue
        features.append(
            {
                "type": "Feature",
                "properties": {"clase": clase, "profundidad": etiqueta},
                "geometry": mapping(simplified),
            }
        )
    return features


def geometry_stats(features: list[dict[str, Any]]) -> tuple[int, int]:
    """(polygon_count, vertex_count) across a list of GeoJSON Feature dicts."""
    polygons = 0
    vertices = 0
    for feature in features:
        geom = feature["geometry"]
        coords = geom["coordinates"]
        if geom["type"] == "Polygon":
            polygons += 1
            vertices += sum(len(ring) for ring in coords)
        elif geom["type"] == "MultiPolygon":
            polygons += len(coords)
            vertices += sum(len(ring) for poly in coords for ring in poly)
    return polygons, vertices


def write_layer_geojson(path: Path, features: list[dict[str, Any]]) -> int:
    """Write a compact FeatureCollection GeoJSON, returning its byte size."""
    payload = {"type": "FeatureCollection", "features": features}
    text = json.dumps(payload, separators=(",", ":"))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(text.encode("utf-8"))
    return len(text.encode("utf-8"))


# --- CLI / orchestration ---


@dataclass
class LevelResult:
    level: float
    filename: str
    bytes_size: int
    hectareas: float
    bordes: dict[str, bool]

    @property
    def toca_borde(self) -> bool:
        return any(self.bordes.values())


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Genera las capas GeoJSON de inundación de Colón a partir del DEM Copernicus."
    )
    parser.add_argument(
        "--out", default=DEFAULT_OUT_DIR, help="Directorio de salida de las capas GeoJSON."
    )
    parser.add_argument("--dem", type=Path, default=None, help="DEM local, evita la red.")
    parser.add_argument("--cero-ign", type=float, default=CERO_IGN_DEFAULT_M)
    parser.add_argument("--tolerance", type=float, default=DEFAULT_TOLERANCE_DEG)
    parser.add_argument("--max-mb", type=float, default=DEFAULT_MAX_MB)
    parser.add_argument(
        "--levels",
        default=None,
        help="Lista de niveles separados por coma (override), p.ej. 3.0,4.0,5.0",
    )
    parser.add_argument(
        "--no-expand",
        action="store_true",
        help="Desactiva la expansión automática este/oeste (para tests/dev).",
    )
    parser.add_argument("--data-dir", default=DEFAULT_DATA_DIR)
    parser.add_argument(
        "--min-area-ha",
        type=float,
        default=DEFAULT_MIN_AREA_HA,
        help="Elimina componentes de agua nueva más chicos que esto (hectáreas).",
    )
    parser.add_argument(
        "--min-hole-ha",
        type=float,
        default=DEFAULT_MIN_HOLE_HA,
        help="Rellena huecos interiores más chicos que esto (hectáreas).",
    )
    parser.add_argument("-v", "--verbose", action="store_true")
    return parser


def configure_logging(verbose: bool) -> None:
    # Root at INFO always: GDAL/rasterio's own DEBUG logging is extremely
    # verbose and not useful here. Only this script's logger goes to DEBUG.
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    logger.setLevel(logging.DEBUG if verbose else logging.INFO)


def _resolve_path(raw: str, repo_root: Path) -> Path:
    path = Path(raw)
    return path if path.is_absolute() else repo_root / path


def _write_levels(
    levels: list[float],
    masks: dict[float, np.ndarray],
    dem: np.ndarray,
    transform: Affine,
    cero_ign: float,
    tolerance: float,
    area_m2: float,
    out_dir: Path,
    min_area_deg2: float = 0.0,
    min_hole_area_deg2: float = 0.0,
) -> tuple[list[LevelResult], int]:
    """Polygonize and write one GeoJSON per level; return results and total bytes."""
    results: list[LevelResult] = []
    total_bytes = 0
    for level in levels:
        mask = masks[level]
        water_elev = level + cero_ign
        features = polygonize_level(
            dem, mask, transform, water_elev, tolerance, min_area_deg2, min_hole_area_deg2
        )
        filename = level_filename(level)
        size = write_layer_geojson(out_dir / filename, features)
        total_bytes += size
        polygons, vertices = geometry_stats(features)
        logger.info(
            "Level %.2f m: %s, %d bytes, %d polygons, %d vertices",
            level,
            filename,
            size,
            polygons,
            vertices,
        )
        results.append(
            LevelResult(
                level=level,
                filename=filename,
                bytes_size=size,
                hectareas=hectares(mask, area_m2),
                bordes=edge_contact(mask),
            )
        )
    return results, total_bytes


def _cleanup_stale_layers(out_dir: Path, keep: set[str]) -> None:
    for path in out_dir.glob("h_*.geojson"):
        if path.name not in keep:
            logger.info("Removing stale layer file: %s", path.name)
            path.unlink()


def _resolve_flood_state(
    bbox: tuple[float, float, float, float],
    data_dir: Path,
    dem_override: Path | None,
    cero_ign: float,
    candidate_levels: list[float],
    allow_expand: bool,
    min_area_ha: float = 0.0,
    min_hole_ha: float = 0.0,
) -> tuple[
    tuple[float, float, float, float],
    np.ndarray,
    Affine,
    dict[float, np.ndarray],
    float,
    dict[str, int],
    dict[str, float | int],
]:
    """Load the DEM, expanding the bbox east/west while new water touches those edges.

    Each candidate level's new-water mask is cleaned with :func:`clean_mask`
    (small components removed, small holes filled) before it is used for
    border detection, hectares, or polygonizing, so all three stay consistent.

    Returns the final bbox, resampled DEM, its transform, the cleaned
    new-water mask per candidate level, the cell area (m²), the count of
    expansions applied and a summary of the base river (level, hectares,
    flat plateaus absorbed).
    """
    expansions = {"este": 0, "oeste": 0}
    while True:
        dem_raw, transform_raw, crs = load_dem(bbox, data_dir, dem_override)
        dem, transform = resample_bilinear(dem_raw, transform_raw, crs, DEFAULT_RESAMPLE_FACTOR)

        lat_centre = (bbox[1] + bbox[3]) / 2.0
        area_m2 = cell_area_m2(transform.a, transform.e, lat_centre)

        seed_lon, seed_lat = SEED_LONLAT
        seed_row0, seed_col0 = rowcol(transform, seed_lon, seed_lat)
        px_w_m = abs(transform.a) * 111_320.0 * math.cos(math.radians(lat_centre))
        px_h_m = abs(transform.e) * 110_540.0
        radius_rows = max(1, math.ceil(SEED_RADIUS_M / px_h_m))
        radius_cols = max(1, math.ceil(SEED_RADIUS_M / px_w_m))
        seed_rc = locate_seed(dem, int(seed_row0), int(seed_col0), radius_rows, radius_cols)

        base_level = base_river_level(float(dem[seed_rc]), cero_ign)
        base_mask, absorbed = base_river_mask(dem, base_level, seed_rc, area_m2)
        base_info: dict[str, float | int] = {
            "nivel_base_ign": round(base_level, 2),
            "hectareas": hectares(base_mask, area_m2),
            "segmentos_planos_absorbidos": absorbed,
        }
        logger.info(
            "Base river: level %.2f m IGN, %.1f ha, %d flat plateau(s) absorbed",
            base_level,
            base_info["hectareas"],
            absorbed,
        )
        masks = {
            level: clean_mask(
                new_water(dem, level, base_mask, cero_ign, seed_rc),
                area_m2,
                min_area_ha,
                min_hole_ha,
            )
            for level in candidate_levels
        }

        if not allow_expand:
            return bbox, dem, transform, masks, area_m2, expansions, base_info

        below_max = [lv for lv in candidate_levels if lv < NIVEL_MAX_M]
        touches_este = any(edge_contact(masks[lv])["este"] for lv in below_max)
        touches_oeste = any(edge_contact(masks[lv])["oeste"] for lv in below_max)

        sides: dict[str, bool] = {}
        if touches_este and expansions["este"] < MAX_EXPANSIONS_PER_SIDE:
            sides["este"] = True
            expansions["este"] += 1
        if touches_oeste and expansions["oeste"] < MAX_EXPANSIONS_PER_SIDE:
            sides["oeste"] = True
            expansions["oeste"] += 1

        if not sides:
            if touches_este or touches_oeste:
                logger.warning(
                    "New water still touches este/oeste after %d expansions per side; "
                    "keeping the border-contact flag.",
                    MAX_EXPANSIONS_PER_SIDE,
                )
            return bbox, dem, transform, masks, area_m2, expansions, base_info

        logger.warning("New water touches bbox edge(s) %s; expanding bbox and re-running.", sides)
        bbox = expand_bbox(bbox, sides)


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    configure_logging(args.verbose)

    repo_root = Path(__file__).resolve().parent.parent
    out_dir = _resolve_path(args.out, repo_root)
    data_dir = _resolve_path(args.data_dir, repo_root)
    out_dir.mkdir(parents=True, exist_ok=True)
    data_dir.mkdir(parents=True, exist_ok=True)

    max_bytes = args.max_mb * 1024 * 1024
    start = time.monotonic()

    west0, south0, east0, north0 = BBOX_INICIAL
    bbox = round_bbox((west0, south0 - MARGEN_NS_DEG, east0, north0 + MARGEN_NS_DEG))

    candidate_levels = plan_levels(0.25)
    bbox, dem, transform, masks, area_m2, expansions, base_info = _resolve_flood_state(
        bbox,
        data_dir,
        args.dem,
        args.cero_ign,
        candidate_levels,
        allow_expand=not args.no_expand,
        min_area_ha=args.min_area_ha,
        min_hole_ha=args.min_hole_ha,
    )

    # Square-degree equivalents of the hectare thresholds, for the belt-and-braces
    # polygon-level filter in polygonize_level (geometries are in lon/lat degrees).
    pixel_area_deg2 = abs(transform.a * transform.e)
    deg2_per_m2 = pixel_area_deg2 / area_m2
    min_area_deg2 = args.min_area_ha * 10_000.0 * deg2_per_m2
    min_hole_area_deg2 = args.min_hole_ha * 10_000.0 * deg2_per_m2

    for level in candidate_levels:
        if level >= NIVEL_MAX_M:
            continue
        touched_ns = [
            side
            for side, hit in edge_contact(masks[level]).items()
            if hit and side in ("norte", "sur")
        ]
        if touched_ns:
            logger.warning("Level %.2f m touches border side(s): %s", level, touched_ns)

    # --- Resolve level set / simplification tolerance to fit the size budget ---

    tolerance = args.tolerance
    if args.levels:
        step_policy = {"hasta_1050": 0.25, "sobre_1050": 0.25}
        final_levels = sorted(float(v) for v in args.levels.split(","))
        results, total_bytes = _write_levels(
            final_levels,
            masks,
            dem,
            transform,
            args.cero_ign,
            tolerance,
            area_m2,
            out_dir,
            min_area_deg2,
            min_hole_area_deg2,
        )
        if total_bytes > max_bytes:
            logger.warning(
                "Overridden level set is %.2f MB, over the %.1f MB budget; kept as requested.",
                total_bytes / 1024 / 1024,
                args.max_mb,
            )
    else:
        # Fixed three-tier step (spec 008, S1): never changed to fit the budget.
        # Only the simplification tolerance escalates below (S2).
        step_policy = DEFAULT_STEP_POLICY
        final_levels = plan_levels(step_policy)
        results, total_bytes = _write_levels(
            final_levels,
            masks,
            dem,
            transform,
            args.cero_ign,
            tolerance,
            area_m2,
            out_dir,
            min_area_deg2,
            min_hole_area_deg2,
        )

        if total_bytes > max_bytes:
            logger.warning(
                "Total size %.2f MB exceeds the %.1f MB budget; increasing the "
                "simplification tolerance (the level range and step stay fixed, "
                "spec 008 S2).",
                total_bytes / 1024 / 1024,
                args.max_mb,
            )
            attempt = 0
            while total_bytes > max_bytes and attempt < MAX_TOLERANCE_ATTEMPTS:
                attempt += 1
                tolerance *= TOLERANCE_GROWTH_FACTOR
                logger.warning(
                    "Still over budget (%.2f MB); increasing simplification tolerance to "
                    "%.6f° (attempt %d/%d).",
                    total_bytes / 1024 / 1024,
                    tolerance,
                    attempt,
                    MAX_TOLERANCE_ATTEMPTS,
                )
                results, total_bytes = _write_levels(
                    final_levels,
                    masks,
                    dem,
                    transform,
                    args.cero_ign,
                    tolerance,
                    area_m2,
                    out_dir,
                    min_area_deg2,
                    min_hole_area_deg2,
                )

            if total_bytes > max_bytes:
                logger.error(
                    "Could not fit layers under %.1f MB after %d tolerance increases (%.2f MB).",
                    args.max_mb,
                    MAX_TOLERANCE_ATTEMPTS,
                    total_bytes / 1024 / 1024,
                )
                return 1

    _cleanup_stale_layers(out_dir, {r.filename for r in results})

    index = {
        "generado": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "fuente_dem": "Copernicus DEM GLO-30 ("
        + ", ".join(
            f"Copernicus_DSM_COG_10_{dem_tile_id(lat, lon)}_DEM"
            for lat, lon in tiles_for_bbox(bbox)
        )
        + ")",
        "licencia_dem": LICENCIA_DEM,
        "cero_ign": args.cero_ign,
        "bbox": list(bbox),
        "bbox_inicial": list(BBOX_INICIAL),
        "margen_ns": MARGEN_NS_DEG,
        "expansiones": expansions,
        "remuestreo": DEFAULT_RESAMPLE_FACTOR,
        "tolerancia_simplificacion": tolerance,
        "limpieza": {"min_area_ha": args.min_area_ha, "min_hole_ha": args.min_hole_ha},
        "rio_base": base_info,
        "paso": step_policy,
        "nivel_max": NIVEL_MAX_M,
        "nivel_min": NIVEL_MIN_M,
        # Spec 008 S4: above this height, the frontend shows "escenario hipotético:
        # nunca registrado en Colón" instead of treating it like a normal scenario.
        "crecida_maxima_observada_m": CRECIDA_MAXIMA_OBSERVADA_M,
        "clases": [{"clase": c, "etiqueta": label} for c, label in DEPTH_CLASSES.items()],
        "capas": [
            {
                "h": r.level,
                "archivo": r.filename,
                "hectareas": r.hectareas,
                "bytes": r.bytes_size,
                "toca_borde": r.toca_borde,
                "bordes": r.bordes,
            }
            for r in sorted(results, key=lambda r: r.level)
        ],
    }
    index_path = out_dir / "index.json"
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")

    elapsed = time.monotonic() - start
    logger.info(
        "Done: %d layers, %.2f MB total, bbox=%s, expansions=%s, tolerance=%.6f, %.1fs",
        len(results),
        total_bytes / 1024 / 1024,
        bbox,
        expansions,
        tolerance,
        elapsed,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
