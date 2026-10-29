import {
  FullscreenControl,
  GeolocateControl,
  Map,
  NavigationControl,
  Popup,
  ScaleControl,
  setWorkerUrl,
  type ErrorEvent,
  type ExpressionSpecification,
  type FilterSpecification,
  type LngLatLike,
  type MapGeoJSONFeature,
} from "maplibre-gl";
// The bundled build cannot find MapLibre's worker next to its own file, as
// the prebuilt build does, so emit the worker as an asset and name it here.
// It stays on this origin, so worker-src 'self' in public/_headers allows it.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import stats from "../data/building-stats.json";
import { textProperty, yearBuilt } from "../lib/building";
import { centroid, type FootprintGeometry } from "../lib/centroid";
import { BACKGROUND, UNKNOWN, YEAR_STOPS } from "../lib/palette";
import { parseShareParams, shareUrl } from "../lib/share";
import { allFilters, YEAR_BUILT, yearFilter, type YearRange } from "../lib/year-filter";
import { announce } from "./announce";
import { describe, popupContent, type Selection } from "./popup";
import { setupYearFilter } from "./year-filter";

setWorkerUrl(workerUrl);

// Show the info panel open on wider screens; on phones it starts collapsed.
const info = document.getElementById("info");
if (info instanceof HTMLDetailsElement && window.matchMedia("(width > 37.5rem)").matches) {
  info.open = true;
}

// The expression arrays mix numbers and colors, so build them untyped
// and hand them to the style as expressions.
const fillColor = [
  "case",
  ["<=", YEAR_BUILT, 0],
  UNKNOWN,
  ["interpolate-lab", ["linear"], YEAR_BUILT, ...YEAR_STOPS.flat()],
] as unknown as ExpressionSpecification;

const FILL = "buildings-fill";
const OUTLINE = "buildings-outline";
const HIGHLIGHT = "buildings-highlight";
const BLDG_ID: ExpressionSpecification = ["to-string", ["get", "bldg_id"]];

/** A building selected from a share link or a flyto event shows at this zoom or closer. */
const BUILDING_ZOOM = 17;
const FLYTO_MIN_ZOOM = 16;

const bounds = { earliest: stats.earliestYear, latest: stats.latestYear };
const shared = parseShareParams(window.location.search);

const map = new Map({
  container: "map",
  center: [-122.676, 45.523],
  zoom: 13,
  minZoom: 10,
  maxBounds: [
    [-122.95, 45.35],
    [-122.25, 45.72],
  ],
  // Keep the map position in the fragment as "#map=zoom/lat/lng",
  // which leaves room for other fragment parameters.
  hash: "map",
  attributionControl: false,
  style: {
    version: 8,
    sources: {
      buildings: {
        type: "vector",
        url: new URL("/tiles/portland_buildings.json", window.location.href).href,
      },
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": BACKGROUND },
      },
      {
        id: FILL,
        type: "fill",
        source: "buildings",
        "source-layer": "buildings",
        paint: { "fill-color": fillColor },
      },
      // A hairline in the background color separates adjacent buildings
      // when they are large enough to show it.
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
      // The selected building, outlined in white over the fill.
      {
        id: HIGHLIGHT,
        type: "line",
        source: "buildings",
        "source-layer": "buildings",
        filter: ["==", BLDG_ID, ""],
        paint: {
          "line-color": "#ffffff",
          "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1.5, 18, 3],
        },
      },
    ],
  },
});

// A share link names a building; center on it before the first render.
if (shared) {
  map.jumpTo({ center: [shared.lng, shared.lat], zoom: BUILDING_ZOOM });
}

map.addControl(new NavigationControl({ showCompass: false }), "top-right");
map.addControl(
  new GeolocateControl({ trackUserLocation: false, positionOptions: { enableHighAccuracy: true } }),
  "top-right",
);
map.addControl(new FullscreenControl(), "top-right");
map.addControl(new ScaleControl({ unit: "imperial" }), "bottom-right");

// Filtering

let rangeFilter: FilterSpecification | null = null;
let selection: Selection | null = null;
// setFilter throws until the style loads, and the year filter can change before then.
let styleLoaded = false;

map.once("load", () => {
  styleLoaded = true;
  applyFilters();
});

function applyFilters() {
  if (!styleLoaded) return;
  map.setFilter(FILL, rangeFilter);
  map.setFilter(OUTLINE, rangeFilter);
  map.setFilter(HIGHLIGHT, allFilters(rangeFilter, ["==", BLDG_ID, selection?.bldgId ?? ""]));
}

setupYearFilter(bounds, (range: YearRange) => {
  rangeFilter = yearFilter(range, bounds);
  applyFilters();
});

// Selection

let popup: Popup | null = null;
/** The element to focus when the popup closes, if focus was in the popup. */
let returnFocus: HTMLElement | null = null;

/** The building's footprint, from every rendered piece of it, since tiles split buildings. */
function footprint(feature: MapGeoJSONFeature): FootprintGeometry | null {
  const id = textProperty(feature.properties, "bldg_id");
  const pieces = id
    ? map.queryRenderedFeatures({ layers: [FILL], filter: ["==", BLDG_ID, id] })
    : [];
  if (pieces.length === 0) pieces.push(feature);
  const polygons: number[][][][] = [];
  for (const { geometry } of pieces) {
    if (geometry.type === "Polygon") polygons.push(geometry.coordinates);
    else if (geometry.type === "MultiPolygon") polygons.push(...geometry.coordinates);
  }
  return polygons.length > 0 ? { type: "MultiPolygon", coordinates: polygons } : null;
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function select(
  feature: MapGeoJSONFeature,
  fallback: { lng: number; lat: number },
  options: { focus: boolean; position?: { lng: number; lat: number } },
) {
  const geometry = options.position ? null : footprint(feature);
  const [lng, lat] = options.position
    ? [options.position.lng, options.position.lat]
    : ((geometry && centroid(geometry)) ?? [fallback.lng, fallback.lat]);
  const next: Selection = {
    bldgId: textProperty(feature.properties, "bldg_id") ?? "",
    yearBuilt: yearBuilt(feature.properties),
    lat: round6(lat),
    lng: round6(lng),
    properties: { ...feature.properties },
  };

  // Replace the open popup without treating its close as the user's.
  const previous = popup;
  popup = null;
  previous?.remove();

  selection = next;
  applyFilters();

  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body && !active.closest(".maplibregl-popup")) {
    returnFocus = active;
  }

  const opened = new Popup({
    closeButton: true,
    closeOnClick: false,
    focusAfterOpen: options.focus,
    maxWidth: "18rem",
  })
    .setLngLat([next.lng, next.lat])
    .setDOMContent(popupContent(next, () => shareSelection(next)))
    .addTo(map);
  opened.on("close", () => {
    if (popup === opened) closed();
  });
  popup = opened;
  revealPopup(opened);

  window.history.replaceState(
    window.history.state,
    "",
    shareUrl(window.location.href, next, window.location.hash),
  );

  const year = next.yearBuilt === null ? "year built unknown" : `built in ${next.yearBuilt}`;
  const address = textProperty(next.properties, "address");
  announce(`Selected ${address ? `${address}, ` : "building, "}${year}.`);

  document.dispatchEvent(
    new CustomEvent("newage:selected", {
      detail: {
        bldgId: next.bldgId,
        yearBuilt: next.yearBuilt,
        lat: next.lat,
        lng: next.lng,
        properties: next.properties,
      },
    }),
  );
}

/**
 * The panels sit above the map, so a popup under one would be hidden.
 * Pan the map the shortest way that moves the popup clear of each panel it overlaps.
 */
function revealPopup(opened: Popup) {
  const margin = 10;
  const box = opened.getElement().getBoundingClientRect();
  let dx = 0;
  let dy = 0;
  for (const panel of document.querySelectorAll<HTMLElement>(".panel:not([hidden])")) {
    const rect = panel.getBoundingClientRect();
    const overlaps =
      box.left + dx < rect.right &&
      box.right + dx > rect.left &&
      box.top + dy < rect.bottom &&
      box.bottom + dy > rect.top;
    if (!overlaps) continue;
    const moves = [
      [rect.right + margin - (box.left + dx), 0],
      [rect.left - margin - (box.right + dx), 0],
      [0, rect.bottom + margin - (box.top + dy)],
      [0, rect.top - margin - (box.bottom + dy)],
    ].filter(([x, y]) => {
      // Keep the popup on the screen.
      return (
        box.left + dx + x >= 0 &&
        box.right + dx + x <= window.innerWidth &&
        box.top + dy + y >= 0 &&
        box.bottom + dy + y <= window.innerHeight
      );
    });
    const shortest = moves.sort((a, b) => Math.hypot(...a) - Math.hypot(...b))[0];
    if (!shortest) continue;
    dx += shortest[0];
    dy += shortest[1];
  }
  if (dx !== 0 || dy !== 0) map.panBy([-dx, -dy]);
}

/** Clears the selection after its popup closes, and keeps focus on the page. */
function closed() {
  popup = null;
  selection = null;
  applyFilters();
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${window.location.hash}`,
  );
  if (document.activeElement === null || document.activeElement === document.body) {
    const target = returnFocus?.isConnected ? returnFocus : map.getCanvas();
    target.focus();
  }
  returnFocus = null;
}

function closePopup() {
  popup?.remove();
}

/**
 * Selects a building at a point: the one with the given ID among the
 * buildings near the point, or else the one at the point.
 * Returns whether it found one.
 */
function selectAt(lngLat: { lng: number; lat: number }, bldgId?: string, focus = false): boolean {
  const point = map.project(lngLat);
  const radius = 24;
  let feature: MapGeoJSONFeature | undefined;
  if (bldgId) {
    feature = map
      .queryRenderedFeatures(
        [
          [point.x - radius, point.y - radius],
          [point.x + radius, point.y + radius],
        ],
        { layers: [FILL] },
      )
      .find((candidate) => textProperty(candidate.properties, "bldg_id") === bldgId);
  }
  // The share link's coordinates came from the whole footprint, which the
  // tiles at this zoom may clip differently; keep them so the link stays the same.
  if (feature) {
    select(feature, lngLat, { focus, position: lngLat });
    return true;
  }
  feature = map.queryRenderedFeatures(point, { layers: [FILL] })[0];
  if (!feature) return false;
  select(feature, lngLat, { focus });
  return true;
}

// Only the canvas handles this action; popup controls retain their own keys.
const canvas = map.getCanvas();
canvas.setAttribute("aria-describedby", "map-keyboard-hint");
const centerMarker = document.createElement("div");
centerMarker.className = "keyboard-center";
centerMarker.setAttribute("aria-hidden", "true");
map.getContainer().append(centerMarker);
canvas.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.target !== canvas || !styleLoaded) return;
  event.preventDefault();
  flight++;
  if (!selectAt(map.getCenter(), undefined, true)) {
    announce("No building at the map center. Use the arrow keys to move the map and try again.");
  }
});

map.on("click", (event) => {
  const [feature] = map.queryRenderedFeatures(event.point, { layers: [FILL] });
  if (feature) select(feature, event.lngLat, { focus: true });
  else closePopup();
});

map.on("mousemove", FILL, () => {
  map.getCanvas().style.cursor = "pointer";
});

map.on("mouseleave", FILL, () => {
  map.getCanvas().style.cursor = "";
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && popup) {
    closePopup();
  }
});

// Sharing

async function shareSelection(building: Selection) {
  const url = shareUrl(window.location.href, building, window.location.hash);
  try {
    if (typeof navigator.share === "function") {
      await navigator.share({ title: `${describe(building)} – New Age of the City`, url });
      announce("Link shared.");
    } else {
      await navigator.clipboard.writeText(url);
      announce("Link copied.");
    }
  } catch (error) {
    // Closing the share sheet rejects with AbortError; that is not a failure.
    if (error instanceof DOMException && error.name === "AbortError") return;
    console.error("Could not share the link", error);
    announce("Could not copy the link.");
  }
}

/** Counts flights, so that a newer flight or selection supersedes an older one. */
let flight = 0;

if (shared) {
  const current = flight;
  map.once("idle", () => {
    if (current === flight) selectAt(shared, shared.bldgId);
  });
}

map.on("click", () => {
  flight++;
});

// Other scripts on the page can ask the map to fly to a point,
// such as a geocoded address, and select the building there.
document.addEventListener("newage:flyto", (event) => {
  const detail = (event as CustomEvent<{ lat: number; lng: number; zoom?: number }>).detail;
  const lat = Number(detail?.lat);
  const lng = Number(detail?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const zoom = Math.max(FLYTO_MIN_ZOOM, Number(detail.zoom) || FLYTO_MIN_ZOOM);
  const current = ++flight;
  const center: LngLatLike = [lng, lat];
  map.once("moveend", () => {
    map.once("idle", () => {
      if (current === flight) selectAt({ lng, lat });
    });
  });
  map.flyTo({ center, zoom });
});

// Loading and errors

const loading = document.getElementById("loading");
const loadError = document.getElementById("load-error");

map.once("idle", () => {
  loading?.remove();
});

document.getElementById("load-error-retry")?.addEventListener("click", () => {
  window.location.reload();
});
document.getElementById("load-error-dismiss")?.addEventListener("click", () => {
  if (loadError) loadError.hidden = true;
  map.getCanvas().focus();
});

let errorShown = false;
map.on("error", (event: ErrorEvent & { sourceId?: string }) => {
  console.error(event.error);
  if (event.sourceId !== "buildings" || errorShown || !loadError) return;
  errorShown = true;
  loading?.remove();
  loadError.hidden = false;
});
