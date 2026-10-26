import { Map, NavigationControl, Popup } from "/vendor/maplibre-gl/maplibre-gl.mjs";

// Show the info panel open on wider screens; on phones it starts collapsed.
if (window.matchMedia("(min-width: 601px)").matches) {
  document.getElementById("info").open = true;
}

const UNKNOWN = "#808080";

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
        paint: { "background-color": "#ffffff" },
      },
      {
        id: "buildings-fill",
        type: "fill",
        source: "buildings",
        "source-layer": "buildings",
        paint: {
          "fill-color": [
            "match",
            ["get", "age_bucket"],
            "pre-1900", "#67001f",
            "1900-1919", "#b2182b",
            "1920-1944", "#d6604d",
            "1945-1959", "#f4a582",
            "1960-1979", "#fddbc7",
            "1980-1999", "#d1e5f0",
            "2000-2009", "#4393c3",
            "2010-present", "#2166ac",
            "unknown", UNKNOWN,
            UNKNOWN,
          ],
          "fill-opacity": 0.8,
        },
      },
      {
        id: "buildings-outline",
        type: "line",
        source: "buildings",
        "source-layer": "buildings",
        paint: {
          "line-color": "#333",
          "line-width": 0.3,
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
