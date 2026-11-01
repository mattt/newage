import { wcagLuminance } from "culori";
import { describe, expect, it } from "vite-plus/test";
import { ROAD, SHORE, STREET, WATER, orientationLayers } from "./orientation";
import { BACKGROUND, UNKNOWN } from "./palette";

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
    expect(orientationLayers().map((layer) => layer.type)).not.toContain("symbol");
  });
});
