// Colors follow the palette of Justin Palmer's 2013 map:
// aquamarine for the oldest buildings, purple for the 1950s,
// and hot pink fading to white for the newest.
// The legend gradient in global.css uses the same stops.
export const BACKGROUND = "#050506";
export const UNKNOWN = "#3a3a3d";
export const YEAR_STOPS: readonly (readonly [year: number, color: string])[] = [
  [1885, "#30fbff"],
  [1920, "#74d5fe"],
  [1940, "#8eabff"],
  [1955, "#b986fa"],
  [1965, "#ed7cfa"],
  [1975, "#fd29ec"],
  [1995, "#ff8cf4"],
  [2010, "#ffc8fb"],
  [2025, "#fff4fe"],
];

/**
 * Returns the ramp color for a year as a hex string.
 * The map interpolates in Lab; this interpolates in sRGB,
 * which is close enough for the small swatches of the histogram.
 */
export function yearColor(year: number): string {
  const first = YEAR_STOPS[0];
  const last = YEAR_STOPS[YEAR_STOPS.length - 1];
  if (year <= first[0]) return first[1];
  if (year >= last[0]) return last[1];
  const upper = YEAR_STOPS.findIndex(([stop]) => stop >= year);
  const [y0, c0] = YEAR_STOPS[upper - 1];
  const [y1, c1] = YEAR_STOPS[upper];
  const t = (year - y0) / (y1 - y0);
  const a = rgb(c0);
  const b = rgb(c1);
  return `#${a
    .map((value, i) => Math.round(value + (b[i] - value) * t).toString(16).padStart(2, "0"))
    .join("")}`;
}

function rgb(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
