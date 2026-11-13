// Reads building points for the launch video: one centroid per footprint with
// its year built and floor area, from data/regional-buildings.ndjson.
//
// The first read streams the NDJSON (about 450 MB) and caches the points, which
// later reads load in well under a second: in data/video/buildings.bin for the
// default NDJSON, and beside any other NDJSON, so that each source keeps its own.
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface } from "node:readline";

export const NDJSON = "data/regional-buildings.ndjson";
const DEFAULT_CACHE = "data/video/buildings.bin";

function cachePath(source: string): string {
  return source === NDJSON ? DEFAULT_CACHE : `${source}.centroids.bin`;
}
/** Bump when the cache layout changes. */
const CACHE_VERSION = 1;

/** Building points in parallel arrays, so that a region query is a tight loop. */
export interface Buildings {
  count: number;
  lng: Float64Array;
  lat: Float64Array;
  /** Year built, or -1 when unknown. */
  year: Int16Array;
  /** Floor area in square feet, or -1 when unknown. */
  sqft: Float32Array;
}

export async function loadBuildings(source = NDJSON): Promise<Buildings> {
  const cache = cachePath(source);
  const cached = await readCache(source, cache);
  if (cached) return cached;
  const buildings = await parse(source);
  await writeCache(buildings, cache);
  return buildings;
}

async function parse(source: string): Promise<Buildings> {
  console.error(`Reading ${source}; this takes a minute the first time.`);
  const lng: number[] = [];
  const lat: number[] = [];
  const year: number[] = [];
  const sqft: number[] = [];
  const lines = createInterface({ input: createReadStream(source), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line) continue;
    const feature = JSON.parse(line);
    const point = ringCenter(feature.geometry);
    if (!point) continue;
    const p = feature.properties ?? {};
    lng.push(point[0]);
    lat.push(point[1]);
    year.push(Number.isInteger(p.year_built) && p.year_built > 0 ? p.year_built : -1);
    sqft.push(typeof p.bldg_sqft === "number" && p.bldg_sqft > 0 ? p.bldg_sqft : -1);
  }
  return {
    count: lng.length,
    lng: Float64Array.from(lng),
    lat: Float64Array.from(lat),
    year: Int16Array.from(year),
    sqft: Float32Array.from(sqft),
  };
}

/**
 * The mean of the outer ring's vertices, weighted by edge length,
 * which is close to the centroid for building footprints and cheap to compute.
 * A multipolygon uses its first polygon.
 */
function ringCenter(geometry: { type: string; coordinates: unknown } | null): [number, number] | null {
  if (!geometry) return null;
  let ring: number[][] | undefined;
  if (geometry.type === "Polygon") ring = (geometry.coordinates as number[][][])[0];
  else if (geometry.type === "MultiPolygon") ring = (geometry.coordinates as number[][][][])[0]?.[0];
  if (!ring || ring.length === 0) return null;
  let x = 0;
  let y = 0;
  let total = 0;
  for (let i = 1; i < ring.length; i++) {
    const [x0, y0] = ring[i - 1];
    const [x1, y1] = ring[i];
    const length = Math.hypot(x1 - x0, y1 - y0);
    x += ((x0 + x1) / 2) * length;
    y += ((y0 + y1) / 2) * length;
    total += length;
  }
  if (total === 0) return [ring[0][0], ring[0][1]];
  return [x / total, y / total];
}

async function readCache(source: string, cache: string): Promise<Buildings | null> {
  try {
    const [cacheStat, sourceStat] = await Promise.all([stat(cache), stat(source)]);
    if (cacheStat.mtimeMs < sourceStat.mtimeMs) return null;
  } catch {
    return null;
  }
  const bytes = await readFile(cache);
  const header = new Uint32Array(bytes.buffer, bytes.byteOffset, 2);
  if (header[0] !== CACHE_VERSION) return null;
  const count = header[1];
  // Copy each array out so that it starts at an aligned offset.
  let offset = 8;
  const take = <T>(type: { new (buffer: ArrayBuffer): T; BYTES_PER_ELEMENT: number }): T => {
    const length = count * type.BYTES_PER_ELEMENT;
    const slice = bytes.buffer.slice(bytes.byteOffset + offset, bytes.byteOffset + offset + length);
    offset += length;
    return new type(slice as ArrayBuffer);
  };
  return {
    count,
    lng: take(Float64Array),
    lat: take(Float64Array),
    year: take(Int16Array),
    sqft: take(Float32Array),
  };
}

async function writeCache(buildings: Buildings, cache: string) {
  await mkdir(dirname(cache), { recursive: true });
  const header = Buffer.from(new Uint32Array([CACHE_VERSION, buildings.count]).buffer);
  const parts = [buildings.lng, buildings.lat, buildings.year, buildings.sqft].map((array) =>
    Buffer.from(array.buffer, array.byteOffset, array.byteLength),
  );
  await writeFile(cache, Buffer.concat([header, ...parts]));
}

/** The latest known year built. */
export function latestYear(buildings: Buildings): number {
  let latest = -1;
  for (const year of buildings.year) if (year > latest) latest = year;
  return latest;
}
