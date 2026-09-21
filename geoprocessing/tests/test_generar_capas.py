"""Pure-numpy unit tests for generar_capas.py's core functions.

No network and no rasterio I/O: every test builds a tiny synthetic DEM.
Run with: uv run --project geoprocessing pytest geoprocessing/tests -q
"""

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from generar_capas import (  # noqa: E402
    base_river_mask,
    classify_depth,
    clean_mask,
    decide_step_policy,
    edge_contact,
    expand_bbox,
    flood_mask,
    geometry_stats,
    hectares,
    level_filename,
    new_water,
    plan_levels,
    round_bbox,
    sanitize_dem,
)


def test_flood_mask_only_includes_cells_connected_to_seed() -> None:
    # A river channel along the top row, and an isolated low basin at the
    # bottom-right, separated by high ground. Both are below water_elev.
    dem = np.array(
        [
            [1.0, 1.0, 1.0, 1.0],
            [9.0, 9.0, 9.0, 9.0],
            [9.0, 9.0, 9.0, 9.0],
            [9.0, 9.0, 1.0, 1.0],
        ]
    )
    seed = (0, 0)
    mask = flood_mask(dem, water_elev=2.0, seed=seed)

    assert mask[0, :].all()  # the river row is flooded
    assert not mask[3, 2:].any()  # the isolated basin is NOT flooded
    assert mask.sum() == 4


def test_flood_mask_seed_above_water_elev_returns_empty() -> None:
    dem = np.full((3, 3), 5.0)
    mask = flood_mask(dem, water_elev=1.0, seed=(1, 1))
    assert not mask.any()


def test_new_water_excludes_base_river() -> None:
    dem = np.array(
        [
            [0.0, 0.5, 3.0],
            [0.5, 1.5, 3.0],
            [3.0, 3.0, 3.0],
        ]
    )
    seed = (0, 0)
    base_mask = flood_mask(dem, water_elev=1.0, seed=seed)  # normal river extent
    result = new_water(dem, level=2.0, base_mask=base_mask, cero_ign=0.0, seed=seed)

    # cell (1, 1) = 1.5 floods only at the higher level, base river excluded
    assert result[1, 1]
    assert not result[0, 0]  # part of the base river, excluded
    assert not result[0, 1]  # part of the base river, excluded
    assert not result[1, 0]  # part of the base river, excluded


def test_classify_depth_boundaries() -> None:
    dem = np.array([[0.0, 0.5, 1.5, 2.0]])
    mask = np.array([[True, True, True, True]])
    water_elev = 2.0
    # depths: 2.0, 1.5, 0.5, 0.0
    classes = classify_depth(dem, mask, water_elev)
    assert classes.tolist() == [[3, 2, 1, 1]]


def test_classify_depth_only_applies_within_mask() -> None:
    dem = np.array([[0.0, 0.0]])
    mask = np.array([[True, False]])
    classes = classify_depth(dem, mask, water_elev=5.0)
    assert classes.tolist() == [[3, 0]]


def test_hectares_monotonic_over_increasing_levels() -> None:
    # A symmetric valley: dem increases with distance from the centre column.
    size = 21
    x = np.abs(np.arange(size) - size // 2)
    dem = np.tile(x.astype(float), (size, 1))
    seed = (size // 2, size // 2)
    base_mask = flood_mask(dem, water_elev=0.0, seed=seed)

    levels = [1.0, 2.0, 3.0, 4.0, 5.0]
    areas = []
    for level in levels:
        mask = new_water(dem, level, base_mask, cero_ign=0.0, seed=seed)
        areas.append(hectares(mask, cell_area_m2=100.0))

    assert areas == sorted(areas)
    assert areas[-1] > areas[0]


def test_edge_contact_sides() -> None:
    mask = np.zeros((4, 4), dtype=bool)
    mask[0, 2] = True  # north
    mask[:, 3] = False
    mask[3, 1] = True  # south
    mask[1, 0] = True  # west
    mask[2, 3] = True  # east

    contact = edge_contact(mask)
    assert contact == {"norte": True, "sur": True, "oeste": True, "este": True}


def test_edge_contact_no_touch() -> None:
    mask = np.zeros((4, 4), dtype=bool)
    mask[1, 1] = True
    contact = edge_contact(mask)
    assert contact == {"norte": False, "sur": False, "oeste": False, "este": False}


def test_decide_step_policy_within_budget() -> None:
    assert decide_step_policy(total_bytes=1_000, max_bytes=15 * 1024 * 1024) == {
        "hasta_1050": 0.25,
        "sobre_1050": 0.25,
    }


def test_decide_step_policy_over_budget() -> None:
    policy = decide_step_policy(total_bytes=20 * 1024 * 1024, max_bytes=15 * 1024 * 1024)
    assert policy == {"hasta_1050": 0.25, "sobre_1050": 0.5}


def test_plan_levels_uniform_has_41_levels() -> None:
    levels = plan_levels(0.25)
    assert len(levels) == 41
    assert levels[0] == 3.0
    assert levels[-1] == 13.0


def test_plan_levels_mixed_has_36_levels() -> None:
    levels = plan_levels({"hasta_1050": 0.25, "sobre_1050": 0.5})
    assert len(levels) == 36
    assert levels[0] == 3.0
    assert levels[-1] == 13.0
    assert 10.5 in levels
    assert 11.0 in levels
    assert 10.75 not in levels  # only every 0.5 above 10.50


def test_expand_bbox_only_moves_east_west() -> None:
    bbox = (-58.25, -32.35, -58.05, -32.10)
    expanded = expand_bbox(bbox, {"este": True, "oeste": True, "norte": True, "sur": True})
    assert expanded == (-58.30, -32.35, -58.00, -32.10)


def test_expand_bbox_no_sides_is_noop() -> None:
    bbox = (-58.25, -32.35, -58.05, -32.10)
    assert expand_bbox(bbox, {}) == bbox


@pytest.mark.parametrize(
    ("level", "expected"),
    [
        (3.0, "h_0300.geojson"),
        (13.0, "h_1300.geojson"),
        (5.75, "h_0575.geojson"),
        (10.5, "h_1050.geojson"),
    ],
)
def test_level_filename(level: float, expected: str) -> None:
    assert level_filename(level) == expected


def test_clean_mask_removes_small_component_keeps_large() -> None:
    mask = np.zeros((6, 6), dtype=bool)
    mask[1:4, 1:4] = True  # 3x3 = 9 cells
    mask[5, 5] = True  # isolated single cell, not adjacent to the block

    # cell_area_m2=100 -> 1 ha == 100 cells; threshold 0.05 ha == 5 cells
    cleaned = clean_mask(mask, cell_area_m2=100.0, min_area_ha=0.05, min_hole_ha=0.0)

    assert cleaned[1:4, 1:4].all()  # the 9-cell block is kept
    assert not cleaned[5, 5]  # the 1-cell speck is removed
    assert cleaned.sum() == 9


def test_clean_mask_fills_small_hole_keeps_large_hole() -> None:
    mask = np.zeros((6, 11), dtype=bool)
    mask[1:4, 1:4] = True  # block A: 3x3
    mask[2, 2] = False  # 1-cell interior hole
    mask[1:5, 6:10] = True  # block B: 4x4
    mask[2:4, 7:9] = False  # 2x2 = 4-cell interior hole

    # threshold 0.03 ha == 3 cells: the 1-cell hole is filled, the 4-cell hole stays
    cleaned = clean_mask(mask, cell_area_m2=100.0, min_area_ha=0.0, min_hole_ha=0.03)

    assert cleaned[2, 2]  # small hole filled
    assert not cleaned[2:4, 7:9].any()  # large hole left alone
    assert cleaned[1:4, 1:4].all()  # block A is fully solid now
    assert cleaned[1, 6:10].all()  # block B's ring is untouched


def test_clean_mask_disabled_is_noop() -> None:
    mask = np.zeros((4, 4), dtype=bool)
    mask[1, 1] = True
    cleaned = clean_mask(mask, cell_area_m2=100.0, min_area_ha=0.0, min_hole_ha=0.0)
    assert np.array_equal(cleaned, mask)
    assert cleaned is mask  # short-circuit returns the same object


def test_geometry_stats_counts_polygons_and_vertices() -> None:
    square = [[0.0, 0.0], [0.0, 1.0], [1.0, 1.0], [1.0, 0.0], [0.0, 0.0]]  # 5 coords
    polygon_geom = {"type": "Polygon", "coordinates": [square]}
    features = [
        {"type": "Feature", "properties": {}, "geometry": polygon_geom},
        {
            "type": "Feature",
            "properties": {},
            "geometry": {"type": "MultiPolygon", "coordinates": [[square], [square]]},
        },
    ]
    polygons, vertices = geometry_stats(features)
    assert polygons == 3  # 1 from the Polygon, 2 from the MultiPolygon
    assert vertices == 15  # 3 rings of 5 coords each


def test_base_river_mask_absorbs_adjacent_flat_plateau_but_not_land() -> None:
    # Columns 0-1: river plateau at 2.0 (seed). Columns 2-6: flat plateau at
    # 2.5 next to the river, like the upstream Copernicus editing segment (only
    # its core, columns 3-5, has a flat 3x3 neighbourhood). Columns 7-10: ridge.
    # Columns 11-15: flat plateau at 2.5 behind the ridge, must stay out.
    # Column 16: sloped land below the cap, must stay out (not flat).
    row = [2.0, 2.0, 2.5, 2.5, 2.5, 2.5, 2.5, 9.0, 9.0, 9.0, 9.0]
    row += [2.5, 2.5, 2.5, 2.5, 2.5]
    dem = np.array([row + [2.6], row + [2.8], row + [3.0], row + [3.2], row + [3.4]])
    mask, absorbed = base_river_mask(
        dem, base_level=2.3, seed=(0, 0), cell_area_m2=10_000.0, min_segment_ha=0.5
    )
    assert absorbed == 1
    assert mask[:, :2].all()
    assert mask[:, 3:6].all()  # flat core of the adjacent plateau
    assert not mask[:, 7:].any()


def test_base_river_mask_respects_min_segment_size_and_elevation_cap() -> None:
    row = [2.0, 2.0, 2.5, 2.5, 2.5, 2.5, 2.5, 4.5, 4.5, 4.5, 4.5, 4.5]
    dem = np.array([row] * 5)
    # Plateau at 2.5 has a 3x5 flat core (15 cells < min 20), plateau at 4.5 is above the cap.
    mask, absorbed = base_river_mask(
        dem, base_level=2.3, seed=(0, 0), cell_area_m2=10_000.0, min_segment_ha=20.0
    )
    assert absorbed == 0
    assert mask[:, :2].all() and not mask[:, 2:].any()

    # Same plateau is absorbed once the minimum size allows it; the 4.5 one still is not.
    mask, absorbed = base_river_mask(
        dem, base_level=2.3, seed=(0, 0), cell_area_m2=10_000.0, min_segment_ha=1.0
    )
    assert absorbed == 1
    assert mask[:, 3:6].all() and not mask[:, 7:].any()


def test_sanitize_dem_trims_empty_edge_column_and_shifts_transform() -> None:
    from affine import Affine

    dem = np.array([[0.0, 5.0, 6.0, 0.0], [0.0, 7.0, 8.0, 0.0]])
    transform = Affine(0.1, 0, -58.0, 0, -0.1, -32.0)
    cleaned, new_transform = sanitize_dem(dem, transform)
    assert cleaned.shape == (2, 2)
    assert new_transform.c == pytest.approx(-57.9)
    assert new_transform.f == pytest.approx(-32.0)
    assert not np.isnan(cleaned).any()


def test_sanitize_dem_interior_zero_becomes_nan_and_never_floods() -> None:
    from affine import Affine

    dem = np.array([[1.0, 0.0, 1.0]])
    cleaned, _ = sanitize_dem(dem, Affine.identity())
    assert np.isnan(cleaned[0, 1])
    assert not flood_mask(cleaned, water_elev=2.0, seed=(0, 0))[0, 1]


def test_round_bbox_removes_float_noise() -> None:
    assert round_bbox((-58.25, -32.30 - 0.05, -58.05, -32.15 + 0.05)) == (
        -58.25,
        -32.35,
        -58.05,
        -32.1,
    )
