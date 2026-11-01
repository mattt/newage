import { describe, expect, it } from "vite-plus/test";
import {
  ageLabel,
  decadeLabel,
  formatCoordinate,
  numberProperty,
  textProperty,
  yearBuilt,
} from "./building";

describe("yearBuilt", () => {
  it("reads a known year", () => {
    expect(yearBuilt({ year_built: 1923 })).toBe(1923);
    expect(yearBuilt({ year_built: "1923" })).toBe(1923);
  });

  it("treats -1, zero, and missing values as unknown", () => {
    expect(yearBuilt({ year_built: -1 })).toBeNull();
    expect(yearBuilt({ year_built: 0 })).toBeNull();
    expect(yearBuilt({})).toBeNull();
    expect(yearBuilt({ year_built: "n/a" })).toBeNull();
  });
});

describe("optional properties", () => {
  it("trims text and ignores blanks", () => {
    expect(textProperty({ address: " 1120 SW 5th Ave " }, "address")).toBe("1120 SW 5th Ave");
    expect(textProperty({ address: "" }, "address")).toBeNull();
    expect(textProperty({}, "address")).toBeNull();
  });

  it("reads positive numbers only", () => {
    expect(numberProperty({ num_story: 3 }, "num_story")).toBe(3);
    expect(numberProperty({ bldg_sqft: "2400" }, "bldg_sqft")).toBe(2400);
    expect(numberProperty({ bldg_sqft: 0 }, "bldg_sqft")).toBeNull();
    expect(numberProperty({ bldg_sqft: null }, "bldg_sqft")).toBeNull();
    expect(numberProperty({}, "bldg_sqft")).toBeNull();
  });
});

describe("labels", () => {
  it("names the decade", () => {
    expect(decadeLabel(1923)).toBe("1920s");
    expect(decadeLabel(2000)).toBe("2000s");
  });

  it("describes the age", () => {
    expect(ageLabel(1923, 2026)).toBe("103 years");
    expect(ageLabel(2025, 2026)).toBe("1 year");
    expect(ageLabel(2026, 2026)).toBe("less than a year");
  });

  it("rounds coordinates to six decimals", () => {
    expect(formatCoordinate(45.52312345)).toBe("45.523123");
    expect(formatCoordinate(-122.6)).toBe("-122.600000");
  });
});
