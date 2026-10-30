/** A position as [longitude, latitude]. */
export type Position = [number, number];

/** The polygonal GeoJSON geometries that a building footprint can have. */
export type FootprintGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

/**
 * Returns the area-weighted centroid of a polygon or multipolygon,
 * treating longitude and latitude as plane coordinates,
 * which is close enough at the size of a building.
 * Holes count against the area because their rings wind the other way.
 * A geometry of another type, or one with no area, gives the mean of its
 * outer ring vertices, or null when it has none.
 */
export function centroid(geometry: { type: string; coordinates?: unknown }): Position | null {
  let polygons: number[][][][];
  if (geometry.type === "Polygon") {
    polygons = [geometry.coordinates as number[][][]];
  } else if (geometry.type === "MultiPolygon") {
    polygons = geometry.coordinates as number[][][][];
  } else {
    return null;
  }

  // Measure from the first vertex to keep the products small and precise.
  const origin = polygons[0]?.[0]?.[0];
  if (!origin) return null;
  const [ox, oy] = origin;

  let area = 0;
  let cx = 0;
  let cy = 0;
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const rings of polygons) {
    for (const [index, ring] of rings.entries()) {
      for (let i = 0; i < ring.length - 1; i++) {
        const x0 = ring[i][0] - ox;
        const y0 = ring[i][1] - oy;
        const x1 = ring[i + 1][0] - ox;
        const y1 = ring[i + 1][1] - oy;
        const cross = x0 * y1 - x1 * y0;
        area += cross;
        cx += (x0 + x1) * cross;
        cy += (y0 + y1) * cross;
        if (index === 0) {
          sumX += x0;
          sumY += y0;
          count++;
        }
      }
    }
  }

  if (Math.abs(area) > 1e-18) {
    return [ox + cx / (3 * area), oy + cy / (3 * area)];
  }
  if (count === 0) return null;
  return [ox + sumX / count, oy + sumY / count];
}
