import { describe, expect, it } from "vite-plus/test";
import { histogramBars } from "./histogram";

describe("histogramBars", () => {
  const bounds = { earliest: 1800, latest: 2025 };
  const bars = histogramBars(
    [
      { decade: 1800, count: 10 },
      { decade: 1900, count: 100 },
      { decade: 2020, count: 0 },
    ],
    bounds,
    226,
    40,
  );

  it("places each decade on the year axis", () => {
    // 226 units for the 226 years from 1800 through 2025.
    expect(bars.map(({ x, width }) => [x, width])).toEqual([
      [0, 10],
      [100, 10],
      [220, 6],
    ]);
    expect(bars[2]).toMatchObject({ start: 2020, end: 2025 });
  });

  it("scales heights to the largest decade", () => {
    expect(bars[1]).toMatchObject({ y: 0, height: 40 });
    expect(bars[0]).toMatchObject({ y: 36, height: 4 });
    expect(bars[2].height).toBe(0);
  });

  it("keeps a small decade visible", () => {
    const [bar] = histogramBars(
      [
        { decade: 1800, count: 1 },
        { decade: 1900, count: 100000 },
      ],
      bounds,
      226,
      40,
    );
    expect(bar.height).toBe(1);
  });
});
