import {
  Map,
  NavigationControl,
  Popup,
  setWorkerUrl,
  type ExpressionSpecification,
} from "maplibre-gl";
// The bundled build cannot find MapLibre's worker next to its own file, as
// the prebuilt build does, so emit the worker as an asset and name it here.
// It stays on this origin, so worker-src 'self' in public/_headers allows it.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

setWorkerUrl(workerUrl);

// Show the info panel open on wider screens; on phones it starts collapsed.
const info = document.getElementById("info");
if (info instanceof HTMLDetailsElement && window.matchMedia("(width > 37.5rem)").matches) {
  info.open = true;
}

// Colors follow the palette of Justin Palmer's 2013 map:
// aquamarine for the oldest buildings, purple for the 1950s,
// and hot pink fading to white for the newest.
// The legend gradient in global.css uses the same stops.
const BACKGROUND = "#050506";
const UNKNOWN = "#3a3a3d";
const YEAR_STOPS = [
  1885, "#30fbff",
  1920, "#74d5fe",
  1940, "#8eabff",
  1955, "#b986fa",
  1965, "#ed7cfa",
  1975, "#fd29ec",
  1995, "#ff8cf4",
  2010, "#ffc8fb",
  2025, "#fff4fe",
];

// The expression arrays mix numbers and colors, so build them untyped
// and hand them to the style as expressions.
const yearBuilt = ["to-number", ["get", "year_built"], -1] as unknown as ExpressionSpecification;
const fillColor = [
  "case",
  ["<", yearBuilt, 0],
  UNKNOWN,
  ["interpolate-lab", ["linear"], yearBuilt, ...YEAR_STOPS],
] as unknown as ExpressionSpecification;

const map = new Map({
  container: "map",
  center: [-122.676, 45.523],
  zoom: 13,
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
        id: "buildings-fill",
        type: "fill",
        source: "buildings",
        "source-layer": "buildings",
        paint: { "fill-color": fillColor },
      },
      // A hairline in the background color separates adjacent buildings
      // when they are large enough to show it.
      {
        id: "buildings-outline",
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

map.addControl(new NavigationControl({ showCompass: false }), "top-right");

const popup = new Popup({ closeButton: false, closeOnClick: false });

map.on("mousemove", "buildings-fill", (event) => {
  const feature = event.features && event.features[0];
  if (!feature) return;
  map.getCanvas().style.cursor = "pointer";
  const year = feature.properties.year_built;
  const label = Number.isInteger(year) && year > 0 ? String(year) : "unknown";
  popup.setLngLat(event.lngLat).setText(`Year built: ${label}`).addTo(map);
});

map.on("mouseleave", "buildings-fill", () => {
  map.getCanvas().style.cursor = "";
  popup.remove();
});
