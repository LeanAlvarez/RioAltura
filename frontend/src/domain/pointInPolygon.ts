/**
 * Point-in-polygon test for GeoJSON `Polygon`/`MultiPolygon` geometries (spec
 * 015, "Mi casa"). Pure, DOM-free: no helper for this existed in the repo
 * before this spec (see odd/tasks/mi-casa.md).
 *
 * GeoJSON coordinates are `[lng, lat]` (the geometry's own contract, see
 * `capas.ts`'s `CapaFeature`), so a `Position` here is `[lng, lat]` too --
 * callers that start from Leaflet's `{lat, lng}` must reorder before calling.
 */

/** `[lng, lat]`, matching the GeoJSON coordinate order (not Leaflet's). */
export type Position = [number, number];
export type LinearRing = readonly Position[];
/** `[exterior, ...holes]`, the GeoJSON `Polygon` contract. */
export type PolygonCoordinates = readonly LinearRing[];
/** One `PolygonCoordinates` per part, the GeoJSON `MultiPolygon` contract. */
export type MultiPolygonCoordinates = readonly PolygonCoordinates[];

export interface GeometryLike {
  type: string;
  coordinates: unknown;
}

/**
 * Ray-casting, even-odd rule, over a single ring. Casts a horizontal ray to
 * the right from `point` and counts edge crossings; odd means inside.
 *
 * Boundary behavior (documented, not fixed): a point that lands exactly on an
 * edge or vertex can come out either `true` or `false`, depending on which
 * edge it grazes -- a well-known property of this algorithm. That ambiguity
 * (sub-metre) is negligible next to the ~20 m polygon simplification
 * tolerance and the 30 m DEM pixel size this data already carries (spec 015,
 * C5), so it is accepted rather than special-cased.
 */
function rayCastRing(point: Position, ring: LinearRing): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const vi = ring[i];
    const vj = ring[j];
    if (!vi || !vj) continue;
    const [xi, yi] = vi;
    const [xj, yj] = vj;
    const cruza = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (cruza) inside = !inside;
  }
  return inside;
}

/**
 * Even-odd across every ring of a polygon (exterior + holes) at once: a
 * point inside a hole crosses both the exterior ring and the hole ring (two
 * crossings, even, outside), while a point inside the exterior but outside
 * every hole crosses only the exterior (one crossing, odd, inside). This is
 * the standard even-odd handling of holes -- no special-casing needed beyond
 * running the same ring test over each ring and toggling.
 */
function pointInRings(point: Position, rings: PolygonCoordinates): boolean {
  let inside = false;
  for (const ring of rings) {
    if (rayCastRing(point, ring)) inside = !inside;
  }
  return inside;
}

/**
 * Pure: is `point` inside `geometry`? Handles `Polygon` (exterior + holes)
 * and `MultiPolygon` (OR across parts, each with its own holes). Any other
 * geometry type (or malformed coordinates) returns `false` rather than
 * throwing -- callers run this inside a binary search (`domain/miCasa.ts`)
 * where a thrown error would break the whole lookup over one bad feature.
 */
export function pointInPolygon(point: Position, geometry: GeometryLike): boolean {
  if (geometry.type === "Polygon") {
    return pointInRings(point, geometry.coordinates as PolygonCoordinates);
  }
  if (geometry.type === "MultiPolygon") {
    const partes = geometry.coordinates as MultiPolygonCoordinates;
    return partes.some((rings) => pointInRings(point, rings));
  }
  return false;
}
