import { describe, expect, it } from "vite-plus/test";
import { yearColor } from "./palette";

describe("yearColor", () => {
  it("returns the stop colors", () => {
    expect(yearColor(1885)).toBe("#30fbff");
    expect(yearColor(1955)).toBe("#b986fa");
    expect(yearColor(2025)).toBe("#fff4fe");
  });

  it("clamps outside the stops", () => {
    expect(yearColor(1800)).toBe("#30fbff");
    expect(yearColor(2030)).toBe("#fff4fe");
  });

  it("interpolates between stops", () => {
    // Halfway from #b986fa (1955) to #ed7cfa (1965).
    expect(yearColor(1960)).toBe("#d381fa");
  });
});
