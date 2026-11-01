import type { ExpressionSpecification, FilterSpecification } from "maplibre-gl";

/** The years that the data covers, from src/data/building-stats.json. */
export interface YearBounds {
  earliest: number;
  latest: number;
}

/** The years that the legend shows. */
export interface YearRange {
  min: number;
  max: number;
  includeUnknown: boolean;
}

/** The year built as a number; an unknown year is -1 in the tiles. */
export const YEAR_BUILT = [
  "to-number",
  ["get", "year_built"],
  -1,
] as unknown as ExpressionSpecification;

export function fullRange(bounds: YearBounds): YearRange {
  return { min: bounds.earliest, max: bounds.latest, includeUnknown: true };
}

/**
 * Returns the filter for buildings in the range, or null when the range
 * includes every building. A bound at the edge of the data does not limit,
 * so a building outside the recorded years still shows.
 * A year of zero or less is unknown.
 */
export function yearFilter(range: YearRange, bounds: YearBounds): FilterSpecification | null {
  const known: ExpressionSpecification[] = [[">", YEAR_BUILT, 0]];
  if (range.min > bounds.earliest) known.push([">=", YEAR_BUILT, range.min]);
  if (range.max < bounds.latest) known.push(["<=", YEAR_BUILT, range.max]);

  if (known.length === 1 && range.includeUnknown) return null;
  const inRange: ExpressionSpecification = ["all", ...known];
  if (!range.includeUnknown) return inRange;
  return ["any", inRange, ["<=", YEAR_BUILT, 0]];
}

/** Combines filters that may be null into one, or null when none apply. */
export function allFilters(
  ...filters: (FilterSpecification | null)[]
): FilterSpecification | null {
  const present = filters.filter((filter) => filter !== null) as ExpressionSpecification[];
  if (present.length === 0) return null;
  if (present.length === 1) return present[0];
  return ["all", ...present];
}

/**
 * Keeps the earliest year at or before the latest year.
 * When the user moves one input past the other, move the other along.
 */
export function orderRange(
  range: YearRange,
  changed: "min" | "max",
  bounds: YearBounds,
): YearRange {
  const clamp = (year: number) =>
    Math.min(bounds.latest, Math.max(bounds.earliest, Math.round(year)));
  let min = clamp(range.min);
  let max = clamp(range.max);
  if (min > max) {
    if (changed === "min") max = min;
    else min = max;
  }
  return { ...range, min, max };
}

export function isFullRange(range: YearRange, bounds: YearBounds): boolean {
  return range.min <= bounds.earliest && range.max >= bounds.latest && range.includeUnknown;
}

/** Returns the latest year at a point in smooth playback, from 0 to 1. */
export function playbackYear(bounds: YearBounds, progress: number): number {
  const t = Math.min(1, Math.max(0, progress));
  return Math.round(bounds.earliest + (bounds.latest - bounds.earliest) * t);
}

/**
 * Returns the latest years for stepped playback, every `step` years
 * from the earliest year and ending at the latest year.
 */
export function playbackSteps(bounds: YearBounds, step: number): number[] {
  const years: number[] = [];
  for (let year = bounds.earliest; year < bounds.latest; year += step) years.push(year);
  years.push(bounds.latest);
  return years;
}
