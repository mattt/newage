// Prints how each place in a places file would animate: the buildings in its
// frame, the spread of their years, and when most of them appear.
//
// Usage: node scripts/video/survey.ts [places.json] [--size 1080x1920] [--buildings-data FILE] [--json]
import { latestYear, loadBuildings, type Buildings } from "./buildings.ts";
import { projector } from "./frame.ts";
import { cameraFor, DEFAULT_PLACES, loadPlaces, parseSize, startYear, type OutputSize, type Place } from "./places.ts";

export interface PlaceStats {
  id: string;
  /** Buildings whose centroid is in the frame. */
  count: number;
  /** Buildings in the frame with a known year. */
  known: number;
  p10: number;
  p50: number;
  p90: number;
  /** The decade with the most buildings, and its share of the known years. */
  peakDecade: number;
  peakShare: number;
  /** The year that the clip starts from. */
  start: number;
  /**
   * The share of the run from the start year to the last year during which
   * the middle 80 percent of the buildings appear. A higher value means the
   * frame keeps changing through the clip instead of filling in all at once.
   */
  activeShare: number;
}

export function survey(buildings: Buildings, place: Place, size: OutputSize, lastYear: number): PlaceStats {
  const project = projector(cameraFor(place, size), size.viewport);
  const years: number[] = [];
  let count = 0;
  for (let i = 0; i < buildings.count; i++) {
    if (!project(buildings.lng[i], buildings.lat[i])) continue;
    count++;
    if (buildings.year[i] > 0) years.push(buildings.year[i]);
  }
  years.sort((a, b) => a - b);
  const quantile = (p: number) => years[Math.floor(p * (years.length - 1))] ?? NaN;
  const decades = new Map<number, number>();
  for (const year of years) {
    const decade = Math.floor(year / 10) * 10;
    decades.set(decade, (decades.get(decade) ?? 0) + 1);
  }
  const [peakDecade, peakCount] = [...decades].sort((a, b) => b[1] - a[1])[0] ?? [NaN, 0];
  const start = startYear(place, years);
  const p10 = quantile(0.1);
  const p90 = quantile(0.9);
  return {
    id: place.id,
    count,
    known: years.length,
    p10,
    p50: quantile(0.5),
    p90,
    peakDecade,
    peakShare: years.length ? peakCount / years.length : 0,
    start,
    activeShare: (p90 - p10) / Math.max(1, lastYear - start),
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const sizeIndex = args.indexOf("--size");
  const size = parseSize(sizeIndex >= 0 ? args[sizeIndex + 1] : "1080x1920");
  const dataIndex = args.indexOf("--buildings-data");
  const file =
    args.find((arg, i) => !arg.startsWith("--") && args[i - 1] !== "--size" && args[i - 1] !== "--buildings-data") ??
    DEFAULT_PLACES;
  const places = await loadPlaces(file);
  const buildings = await loadBuildings(dataIndex >= 0 ? args[dataIndex + 1] : undefined);
  const lastYear = latestYear(buildings);
  const rows = places.map((place) => survey(buildings, place, size, lastYear));
  if (json) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    console.table(
      rows.map((row) => ({
        id: row.id,
        count: row.count,
        known: row.known,
        "p10–p90": `${row.p10}–${row.p90}`,
        median: row.p50,
        peak: `${row.peakDecade}s ${(row.peakShare * 100).toFixed(0)}%`,
        start: row.start,
        active: `${(row.activeShare * 100).toFixed(0)}%`,
      })),
    );
  }
}
