import { describe, expect, it } from "vite-plus/test";
import { loadShapes } from "./og";
import { cardSvg, metadata, parseSelection, STOPS, tilePoint, yearColor } from "./og-model";
const query = "?building=1S1E03BB-4800-B1&year=1978&lat=45.519148&lng=-122.680321";
const url = new URL(`https://ageofthe.city/${query}`);
describe("building card", () => {
  it("validates complete queries and unknown years", () => {
    expect(parseSelection(url)?.year).toBe(1978);
    expect(parseSelection(new URL(url.href.replace("1978", "unknown")))?.year).toBeNull();
    for (const [key, values] of Object.entries({
      building: ["", "<script>", "a_b"],
      year: ["1699", "2101", "19.5", "NaN"],
      lat: ["", "Infinity", "46"],
      lng: ["0", "-123"],
    }))
      for (const value of values) {
        const bad = new URL(url);
        bad.searchParams.set(key, value);
        expect(parseSelection(bad)).toBeNull();
      }
    const duplicate = new URL(url);
    duplicate.searchParams.append("year", "1978");
    expect(parseSelection(duplicate)).toBeNull();
    expect(parseSelection(new URL("https://ageofthe.city/"))).toBeNull();
  });
  it("projects known points into tile coordinates", () => {
    expect(tilePoint(0, 0, 13)).toEqual({ x: 4096, y: 4096 });
    const p = tilePoint(45.519148, -122.680321, 13);
    expect(Math.floor(p.x)).toBe(1304);
    expect(Math.floor(p.y)).toBe(2930);
  });
  it("uses the Lab ramp, clamps ends, and handles unknown", () => {
    for (const [year, color] of STOPS) expect(yearColor(year)).toBe(color);
    expect(yearColor(1902.5)).toBe("#5ce8ff");
    expect(yearColor(null)).toBe("#3a3a3d");
    expect(yearColor(1700)).toBe(STOPS[0][1]);
    expect(yearColor(2100)).toBe(STOPS.at(-1)![1]);
  });
  it("builds a map card with the selected outline and fixed age", () => {
    const svg = cardSvg(
      parseSelection(url)!,
      [
        {
          id: "1S1E03BB-4800-B1",
          year: 1978,
          rings: [
            [
              { x: 850, y: 300 },
              { x: 890, y: 300 },
              { x: 890, y: 340 },
            ],
          ],
        },
      ],
      2026,
    );
    expect(svg).toContain('width="1200" height="630"');
    expect(svg).toContain('stroke="#ffffff"');
    expect(svg).toContain("48 years old");
    expect(svg).toContain("M850.00,300.00");
    expect(cardSvg({ ...parseSelection(url)!, year: null }, [], 2026)).toContain(
      "Year built unknown",
    );
  });
  it("rewrites only valid home URLs and versions the image", () => {
    expect(metadata(url, "archive-etag", 2026)?.image).toContain("v=archive-etag&asof=2026");
    expect(metadata(new URL("https://ageofthe.city/other/" + query), "v", 2026)).toBeNull();
    expect(metadata(new URL("https://ageofthe.city/?year=bad"), "v", 2026)).toBeNull();
  });
});

it("reads the requested archive zoom from a fake tile source", async () => {
  const calls: number[] = [];
  const shapes = await loadShapes(
    {
      async getZxy(z) {
        calls.push(z);
        return undefined;
      },
    },
    parseSelection(url)!,
    13,
  );
  expect(shapes).toEqual([]);
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.every((z) => z === 13)).toBe(true);
});

it("normalizes coordinate precision before forming the image key", () => {
  const precise = new URL(url);
  precise.searchParams.set("lat", "45.51914801");
  precise.searchParams.set("lng", "-122.68032101");
  expect(metadata(precise, "archive", 2026)).toEqual(metadata(url, "archive", 2026));
});

it("highlights all fragments with the selected or fallback building ID", () => {
  const ring = [{ x: 870, y: 300 }, { x: 900, y: 300 }, { x: 900, y: 330 }];
  const shapes = [
    { id: "shared", year: 1978, rings: [ring] },
    { id: "shared", year: 1978, rings: [ring] },
    { id: "other", year: 1978, rings: [ring] },
  ];
  for (const building of ["shared", "missing"]) {
    const svg = cardSvg({ ...parseSelection(url)!, building }, shapes, 2026);
    expect(svg.match(/stroke="#ffffff"/g)).toHaveLength(2);
    expect(svg.match(/opacity="1"/g)).toHaveLength(2);
  }
  const anonymous = shapes.map((shape) => ({ ...shape, id: "" }));
  expect(cardSvg(parseSelection(url)!, anonymous, 2026).match(/stroke="#ffffff"/g)).toHaveLength(1);
});
