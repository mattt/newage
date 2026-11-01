import { wcagLuminance } from "culori";
import { describe, expect, it } from "vite-plus/test";
import { ROAD, SHORE, STREET, VARIANTS, WATER, orientationLayers, parseVariant } from "./orientation";
import { BACKGROUND, UNKNOWN } from "./palette";

describe("parseVariant", () => {
  it("reads a known variant", () => {
    expect(parseVariant("?orientation=streets")).toBe("streets");
    expect(parseVariant("?bldg=1&orientation=water")).toBe("water");
  });

  it("ignores a missing or unknown variant", () => {
    expect(parseVariant("")).toBeNull();
    expect(parseVariant("?orientation=satellite")).toBeNull();
  });
});

describe("orientation colors", () => {
  it("stay between the background and the dimmest building color", () => {
    const floor = wcagLuminance(BACKGROUND);
    const ceiling = wcagLuminance(UNKNOWN);
    for (const color of [WATER, SHORE, ROAD, STREET]) {
      expect(wcagLuminance(color)).toBeGreaterThan(floor);
      expect(wcagLuminance(color)).toBeLessThan(ceiling);
    }
  });
});

describe("orientationLayers", () => {
  it("adds no labels", () => {
    for (const variant of VARIANTS) {
      expect(orientationLayers(variant).map((layer) => layer.type)).not.toContain("symbol");
    }
  });
});
