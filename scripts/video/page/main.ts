// The map for video frames. The style follows src/scripts/map.ts, without the
// selection highlight, and the year range uses the site's own filter, so a
// frame matches the site's Play at the same year.
import {
  Map,
  addProtocol,
  setNow,
  type ExpressionSpecification,
  type FilterSpecification,
} from "/maplibre-gl/maplibre-gl.mjs";
import { ORIENTATION_SOURCE, orientationLayers } from "/src/lib/orientation.ts";
import { BACKGROUND, UNKNOWN, YEAR_STOPS } from "/src/lib/palette.ts";
import { YEAR_BUILT, yearFilter, type YearBounds } from "/src/lib/year-filter.ts";

declare const pmtiles: { Protocol: new () => { tile: Parameters<typeof addProtocol>[1] } };

const protocol = new pmtiles.Protocol();
addProtocol("pmtiles", protocol.tile);
// Freeze MapLibre's clock so that no frame catches a transition partway.
setNow(0);

const fillColor = [
  "case",
  ["<=", YEAR_BUILT, 0],
  UNKNOWN,
  ["interpolate-lab", ["linear"], YEAR_BUILT, ...YEAR_STOPS.flat()],
] as unknown as ExpressionSpecification;

const FILL = "buildings-fill";
const OUTLINE = "buildings-outline";

const params = new URLSearchParams(window.location.search);
const tiles = (name: string) => `pmtiles://${new URL(`/tiles/${name}.pmtiles`, window.location.href).href}`;

const map = new Map({
  container: "map",
  center: [-122.676, 45.523],
  zoom: 13,
  interactive: false,
  attributionControl: false,
  fadeDuration: 0,
  pixelRatio: Number(params.get("pixelRatio")) || window.devicePixelRatio,
  canvasContextAttributes: { antialias: true, preserveDrawingBuffer: true },
  style: {
    version: 8,
    sources: {
      buildings: { type: "vector", url: tiles("buildings") },
      [ORIENTATION_SOURCE]: { type: "vector", url: tiles("orientation") },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": BACKGROUND } },
      ...orientationLayers(),
      {
        id: FILL,
        type: "fill",
        source: "buildings",
        "source-layer": "buildings",
        paint: { "fill-color": fillColor },
      },
      {
        id: OUTLINE,
        type: "line",
        source: "buildings",
        "source-layer": "buildings",
        minzoom: 15,
        paint: {
          "line-color": BACKGROUND,
          "line-width": ["interpolate", ["linear"], ["zoom"], 15, 0.3, 18, 1],
        },
      },
    ],
  },
});

const loaded = new Promise<void>((resolve) => map.once("load", () => resolve()));
const errors: string[] = [];
map.on("error", (event) => errors.push(String(event.error?.message ?? event.error)));

/** Resolves once every tile in view has loaded and the frame has drawn. */
function settled(): Promise<void> {
  return new Promise((resolve) => {
    map.once("idle", () => resolve());
    map.triggerRepaint();
  });
}

const label = document.getElementById("label")!;
const labelName = document.getElementById("label-name")!;
const labelYear = document.getElementById("label-year")!;

interface FrameState {
  center: [number, number];
  zoom: number;
  /** The latest year shown; the earliest is the start of the data. */
  year: number;
  bounds: YearBounds;
  includeUnknown: boolean;
  /** The place name, or null for no label. */
  name: string | null;
}

let current = "";

/** The renderer calls this for each distinct frame, then captures the page. */
async function show(state: FrameState): Promise<string[]> {
  await loaded;
  const camera = JSON.stringify([state.center, state.zoom]);
  if (camera !== current) {
    current = camera;
    map.jumpTo({ center: state.center, zoom: state.zoom });
  }
  const filter: FilterSpecification | null = yearFilter(
    { min: state.bounds.earliest, max: state.year, includeUnknown: state.includeUnknown },
    state.bounds,
  );
  map.setFilter(FILL, filter);
  map.setFilter(OUTLINE, filter);
  label.hidden = state.name === null;
  labelName.textContent = state.name ?? "";
  labelYear.textContent = String(state.year);
  await settled();
  return errors.splice(0);
}

Object.assign(window, { video: { show } });
