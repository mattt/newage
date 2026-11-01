import type { FilterSpecification } from "maplibre-gl";
import { describe, expect, it } from "vite-plus/test";
import {
  allFilters,
  fullRange,
  isFullRange,
  orderRange,
  playbackSteps,
  playbackYear,
  YEAR_BUILT,
  yearFilter,
} from "./year-filter";

const bounds = { earliest: 1800, latest: 2025 };

describe("yearFilter", () => {
  it("does not filter the full range", () => {
    expect(yearFilter(fullRange(bounds), bounds)).toBeNull();
  });

  it("hides unknown years", () => {
    expect(yearFilter({ ...fullRange(bounds), includeUnknown: false }, bounds)).toEqual([
      "all",
      [">", YEAR_BUILT, 0],
    ]);
  });

  it("limits both ends and keeps unknown years", () => {
    expect(yearFilter({ min: 1900, max: 1950, includeUnknown: true }, bounds)).toEqual([
      "any",
      ["all", [">", YEAR_BUILT, 0], [">=", YEAR_BUILT, 1900], ["<=", YEAR_BUILT, 1950]],
      ["<=", YEAR_BUILT, 0],
    ]);
  });

  it("leaves out a bound at the edge of the data", () => {
    expect(yearFilter({ min: 1800, max: 1950, includeUnknown: false }, bounds)).toEqual([
      "all",
      [">", YEAR_BUILT, 0],
      ["<=", YEAR_BUILT, 1950],
    ]);
  });
});

describe("allFilters", () => {
  it("skips missing filters", () => {
    const highlight: FilterSpecification = ["==", ["get", "bldg_id"], "1"];
    expect(allFilters(null, null)).toBeNull();
    expect(allFilters(null, highlight)).toEqual(highlight);
    expect(allFilters([">", YEAR_BUILT, 0], highlight)).toEqual([
      "all",
      [">", YEAR_BUILT, 0],
      highlight,
    ]);
  });
});

describe("orderRange", () => {
  it("moves the latest year up with the earliest year", () => {
    expect(orderRange({ min: 1990, max: 1950, includeUnknown: true }, "min", bounds)).toEqual({
      min: 1990,
      max: 1990,
      includeUnknown: true,
    });
  });

  it("moves the earliest year down with the latest year", () => {
    expect(orderRange({ min: 1990, max: 1950, includeUnknown: false }, "max", bounds)).toEqual({
      min: 1950,
      max: 1950,
      includeUnknown: false,
    });
  });

  it("clamps to the data's years", () => {
    expect(orderRange({ min: 1700, max: 2100, includeUnknown: true }, "min", bounds)).toEqual(
      fullRange(bounds),
    );
  });

  it("recognizes the full range", () => {
    expect(isFullRange(fullRange(bounds), bounds)).toBe(true);
    expect(isFullRange({ ...fullRange(bounds), includeUnknown: false }, bounds)).toBe(false);
    expect(isFullRange({ ...fullRange(bounds), max: 2000 }, bounds)).toBe(false);
  });
});

describe("playback", () => {
  it("interpolates the latest year", () => {
    expect(playbackYear(bounds, 0)).toBe(1800);
    expect(playbackYear(bounds, 0.5)).toBe(1913);
    expect(playbackYear(bounds, 1)).toBe(2025);
    expect(playbackYear(bounds, 2)).toBe(2025);
  });

  it("steps by five years and ends at the latest year", () => {
    const steps = playbackSteps(bounds, 5);
    expect(steps.slice(0, 3)).toEqual([1800, 1805, 1810]);
    expect(steps.slice(-2)).toEqual([2020, 2025]);
    expect(playbackSteps({ earliest: 2000, latest: 2007 }, 5)).toEqual([2000, 2005, 2007]);
  });
});
