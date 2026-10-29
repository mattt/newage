import type { YearBounds } from "./year-filter";

export interface DecadeCount {
  decade: number;
  count: number;
}

export interface HistogramBar {
  decade: number;
  count: number;
  /** The first and last years of the decade within the data's years. */
  start: number;
  end: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Lays out one bar for each decade on an axis from the earliest year to the
 * end of the latest year, so the bars line up with range inputs over the
 * same years. Bars with any buildings are at least one unit tall.
 */
export function histogramBars(
  byDecade: readonly DecadeCount[],
  bounds: YearBounds,
  width: number,
  height: number,
): HistogramBar[] {
  const span = bounds.latest + 1 - bounds.earliest;
  const scale = (year: number) => ((year - bounds.earliest) / span) * width;
  const maxCount = Math.max(1, ...byDecade.map(({ count }) => count));

  return byDecade
    .filter(({ decade }) => decade + 10 > bounds.earliest && decade <= bounds.latest)
    .map(({ decade, count }) => {
      const start = Math.max(decade, bounds.earliest);
      const end = Math.min(decade + 9, bounds.latest);
      const barHeight = count > 0 ? Math.max(1, (count / maxCount) * height) : 0;
      return {
        decade,
        count,
        start,
        end,
        x: scale(start),
        y: height - barHeight,
        width: scale(end + 1) - scale(start),
        height: barHeight,
      };
    });
}
