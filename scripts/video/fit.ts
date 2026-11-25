// Finds the tightest frame that holds a given share of all the buildings,
// for a whole-city shot: the center and zoom that make the built-up area
// fill the frame while giving up only the outlying buildings.
//
// Usage: node scripts/video/fit.ts [--size 1920x1080] [--share 0.93]
import { parseArgs } from "node:util";
import { loadBuildings, type Buildings } from "./buildings.ts";
import { parseSize, type OutputSize } from "./places.ts";

const TILE = 512;

/** Web Mercator at zoom 0, in 512-pixel tiles, as MapLibre uses. */
function mercator(lng: number, lat: number): [number, number] {
  const s = Math.sin((lat * Math.PI) / 180);
  return [((lng + 180) / 360) * TILE, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE];
}

function unmercator(x: number, y: number): [number, number] {
  const lng = (x / TILE) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / TILE;
  return [lng, (180 / Math.PI) * Math.atan(Math.sinh(n))];
}

export interface Fit {
  center: [lng: number, lat: number];
  zoom: number;
  /** The share of all buildings whose centroid falls in the frame. */
  share: number;
}

/**
 * For a frame of the viewport's shape centered at (cx, cy), each building
 * needs the frame to be at least a certain size, in zoom-0 pixels per CSS
 * pixel; the share-quantile of those sizes is the smallest frame that holds
 * the share. The best center is the one whose smallest frame is smallest.
 */
export function fit(buildings: Buildings, size: OutputSize, share: number): Fit {
  const halfWidth = size.viewport.width / 2;
  const halfHeight = size.viewport.height / 2;
  const xs = new Float64Array(buildings.count);
  const ys = new Float64Array(buildings.count);
  for (let i = 0; i < buildings.count; i++) [xs[i], ys[i]] = mercator(buildings.lng[i], buildings.lat[i]);

  // Search on every 8th building, then measure the result on all of them.
  const step = 8;
  const needed = (cx: number, cy: number, stride: number) => {
    const sizes = new Float64Array(Math.ceil(xs.length / stride));
    for (let i = 0, j = 0; i < xs.length; i += stride, j++) {
      sizes[j] = Math.max(Math.abs(xs[i] - cx) / halfWidth, Math.abs(ys[i] - cy) / halfHeight);
    }
    sizes.sort();
    return sizes[Math.min(sizes.length - 1, Math.ceil(share * sizes.length) - 1)];
  };

  let [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity];
  for (let i = 0; i < xs.length; i += step) {
    minX = Math.min(minX, xs[i]);
    maxX = Math.max(maxX, xs[i]);
    minY = Math.min(minY, ys[i]);
    maxY = Math.max(maxY, ys[i]);
  }
  let best = { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, scale: Infinity };
  let spanX = maxX - minX;
  let spanY = maxY - minY;
  // Narrow a 9-by-9 grid of centers around the best one, five times.
  for (let round = 0; round < 5; round++) {
    const { cx, cy } = best;
    for (let i = -4; i <= 4; i++) {
      for (let j = -4; j <= 4; j++) {
        const x = cx + (i / 8) * spanX;
        const y = cy + (j / 8) * spanY;
        const scale = needed(x, y, step);
        if (scale < best.scale) best = { cx: x, cy: y, scale };
      }
    }
    spanX /= 4;
    spanY /= 4;
  }

  const scale = needed(best.cx, best.cy, 1);
  let inside = 0;
  for (let i = 0; i < xs.length; i++) {
    if (Math.abs(xs[i] - best.cx) <= scale * halfWidth && Math.abs(ys[i] - best.cy) <= scale * halfHeight) inside++;
  }
  return { center: unmercator(best.cx, best.cy), zoom: -Math.log2(scale), share: inside / xs.length };
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      size: { type: "string", multiple: true },
      share: { type: "string", multiple: true },
    },
  });
  const buildings = await loadBuildings();
  for (const text of values.size?.length ? values.size : ["1920x1080", "1080x1920"]) {
    const size = parseSize(text);
    for (const share of (values.share?.length ? values.share : ["0.90", "0.92", "0.93", "0.94", "0.95"]).map(Number)) {
      const result = fit(buildings, size, share);
      console.log(
        `${text} ${(share * 100).toFixed(0)}%: center [${result.center.map((v) => v.toFixed(4)).join(", ")}], ` +
          `zoom ${result.zoom.toFixed(3)}, holds ${(result.share * 100).toFixed(2)}%`,
      );
    }
  }
}
