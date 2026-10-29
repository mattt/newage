import { describe, expect, it } from "vite-plus/test";
import { centroid } from "./centroid";

const square = [
  [-122.68, 45.52],
  [-122.67, 45.52],
  [-122.67, 45.53],
  [-122.68, 45.53],
  [-122.68, 45.52],
];

function expectClose(actual: [number, number] | null, expected: [number, number]) {
  expect(actual).not.toBeNull();
  expect(actual![0]).toBeCloseTo(expected[0], 9);
  expect(actual![1]).toBeCloseTo(expected[1], 9);
}

describe("centroid", () => {
  it("finds the center of a square", () => {
    expectClose(centroid({ type: "Polygon", coordinates: [square] }), [-122.675, 45.525]);
  });

  it("gives the same result for either winding", () => {
    const reversed = [...square].reverse();
    expectClose(centroid({ type: "Polygon", coordinates: [reversed] }), [-122.675, 45.525]);
  });

  it("weights an L shape by area", () => {
    // Two unit squares side by side and one above the left one.
    const shape = [
      [0, 0],
      [2, 0],
      [2, 1],
      [1, 1],
      [1, 2],
      [0, 2],
      [0, 0],
    ];
    expectClose(centroid({ type: "Polygon", coordinates: [shape] }), [5 / 6, 5 / 6]);
  });

  it("subtracts a hole", () => {
    const outer = [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
      [0, 0],
    ];
    const hole = [
      [2, 0],
      [2, 4],
      [4, 4],
      [4, 0],
      [2, 0],
    ];
    // Removing the right half leaves a 2 by 4 rectangle.
    expectClose(centroid({ type: "Polygon", coordinates: [outer, hole] }), [1, 2]);
  });

  it("combines the parts of a multipolygon", () => {
    const a = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ];
    const b = [
      [3, 0],
      [4, 0],
      [4, 1],
      [3, 1],
      [3, 0],
    ];
    expectClose(centroid({ type: "MultiPolygon", coordinates: [[a], [b]] }), [2, 0.5]);
  });

  it("falls back to the mean vertex for a degenerate ring", () => {
    const line = [
      [0, 0],
      [2, 0],
      [0, 0],
    ];
    expectClose(centroid({ type: "Polygon", coordinates: [line] }), [1, 0]);
  });

  it("returns null for other geometries and empty polygons", () => {
    expect(centroid({ type: "Point", coordinates: [0, 0] })).toBeNull();
    expect(centroid({ type: "Polygon", coordinates: [] })).toBeNull();
  });
});
