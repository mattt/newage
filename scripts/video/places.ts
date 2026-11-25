// The places that the launch video visits, read from a JSON file such as
// scripts/video/places.json.
import { readFile } from "node:fs/promises";
import type { Camera, Viewport } from "./frame.ts";

export const DEFAULT_PLACES = "scripts/video/places.json";

export interface Place extends Camera {
  id: string;
  /** The label in the corner of the frame. */
  name: string;
  /** The first year of the clip; by default, from the buildings in the frame. */
  start?: number;
  /**
   * Cameras for particular output shapes, keyed by a size such as "1920x1080",
   * in place of the center and zoom. A size of the same shape uses the same camera.
   */
  frames?: Record<string, Camera>;
  /** The place's own pace, in place of --years-per-second. */
  yearsPerSecond?: number;
  /** The place's own time on its last year, in place of --hold. */
  hold?: number;
  /** The short side in pixels at which to draw the map before scaling it down to the output. */
  raster?: number;
  /** The place's own level lift for scaled-down frames, in place of --lift. */
  lift?: number;
  /** The place's own note density limit, in place of --busiest. */
  busiest?: number | "auto";
}

/** The place's camera for an output size. */
export function cameraFor(place: Place, size: OutputSize): Camera {
  const frames = Object.entries(place.frames ?? {});
  const match =
    frames.find(([key]) => key === size.name) ??
    frames.find(([key]) => {
      const other = parseSize(key);
      return Math.abs(other.width / other.height - size.width / size.height) < 1e-6;
    });
  return match?.[1] ?? { center: place.center, zoom: place.zoom };
}

export async function loadPlaces(file: string): Promise<Place[]> {
  const places = JSON.parse(await readFile(file, "utf8")) as Place[];
  for (const place of places) {
    if (!place.id || !Array.isArray(place.center) || typeof place.zoom !== "number") {
      throw new Error(`${file}: each place needs an id, a center, and a zoom`);
    }
  }
  return places;
}

/**
 * The short side of every frame is this many CSS pixels, whatever the output size,
 * so that a place's zoom shows the same width of ground in either orientation.
 */
export const SHORT_SIDE = 540;

export interface OutputSize {
  /** The size as written, such as "1920x1080". */
  name: string;
  width: number;
  height: number;
  /** The CSS size of the map, which the pixel ratio scales up to the output size. */
  viewport: Viewport;
  pixelRatio: number;
}

export function parseSize(text: string): OutputSize {
  const match = /^(\d+)x(\d+)$/.exec(text);
  if (!match) throw new Error(`Expected a size such as 1080x1920, got ${text}`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  const pixelRatio = Math.min(width, height) / SHORT_SIDE;
  return {
    name: text,
    width,
    height,
    pixelRatio,
    viewport: { width: width / pixelRatio, height: height / pixelRatio },
  };
}

/**
 * The first year of a place's clip: its own start, or the decade before
 * the earliest two percent of its buildings, so that the clip does not open
 * on decades of empty ground.
 */
export function startYear(place: Place, sortedYears: number[]): number {
  if (place.start !== undefined) return place.start;
  if (sortedYears.length === 0) return 1900;
  const early = sortedYears[Math.floor(0.02 * (sortedYears.length - 1))];
  return Math.floor(early / 10) * 10 - 10;
}
