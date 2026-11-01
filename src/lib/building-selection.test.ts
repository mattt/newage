import { featureFilter } from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it } from "vite-plus/test";
import { selectionFilter } from "./building-selection";
import { allFilters, yearFilter } from "./year-filter";

const matches = (id: string | undefined, properties: Record<string, unknown>) =>
  featureFilter(selectionFilter(id), "filter").filter({ zoom: 13 }, { type: 3, properties });

describe("building highlight", () => {
  it("never matches missing, empty, or null IDs when nothing is selected", () => {
    for (const properties of [{}, { bldg_id: "" }, { bldg_id: "building-1" }]) {
      expect(matches(undefined, properties)).toBe(false);
      expect(matches("", properties)).toBe(false);
    }
    expect(featureFilter(selectionFilter(), "filter").filter(
      { zoom: 13 }, { type: 3, properties: { bldg_id: null } },
    )).toBe(false);
  });

  it("matches only the selected ID, including when combined with a year filter", () => {
    expect(matches("building-1", {})).toBe(false);
    expect(matches("building-1", { bldg_id: "" })).toBe(false);
    expect(matches("building-1", { bldg_id: "building-2" })).toBe(false);
    expect(matches("building-1", { bldg_id: "building-1" })).toBe(true);
    const filter = allFilters(
      yearFilter({ min: 1800, max: 1900, includeUnknown: false }, { earliest: 1800, latest: 2026 }),
      selectionFilter("building-1"),
    );
    const evaluate = featureFilter(filter ?? undefined, "filter").filter;
    expect(evaluate({ zoom: 13 }, { type: 3, properties: { bldg_id: "building-1", year_built: 1890 } })).toBe(true);
    expect(evaluate({ zoom: 13 }, { type: 3, properties: { bldg_id: "building-1", year_built: 2020 } })).toBe(false);
  });
});
