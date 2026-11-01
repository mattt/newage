import type { ExpressionSpecification, LayerSpecification } from "maplibre-gl";

// Faint water and roads under the buildings, from data/orientation.pmtiles
// (see scripts/build_orientation.sh). The buildings are the subject, so every
// color here is darker than UNKNOWN, the dimmest building color.
//
// This is a prototype: the map draws a variant only when the page URL names
// one, as in "?orientation=streets". Without the parameter, the map is unchanged.

export const ORIENTATION_SOURCE = "orientation";
export const ORIENTATION_TILEJSON = "/tiles/orientation.json";

export const WATER = "#0a0f15";
export const SHORE = "#16202b";
export const ROAD = "#1c1c21";
export const STREET = "#151519";

export const VARIANTS = ["water", "roads", "streets"] as const;
export type Variant = (typeof VARIANTS)[number];

/** Reads the variant from a query string such as "?orientation=roads". */
export function parseVariant(search: string): Variant | null {
  const value = new URLSearchParams(search).get("orientation");
  return VARIANTS.find((variant) => variant === value) ?? null;
}

const POLYGON: ExpressionSpecification = ["==", ["geometry-type"], "Polygon"];
const LINE: ExpressionSpecification = ["==", ["geometry-type"], "LineString"];
const MAJOR: ExpressionSpecification = ["match", ["get", "kind"], ["highway", "major_road"], true, false];
const HIGHWAY: ExpressionSpecification = ["==", ["get", "kind"], "highway"];
const MINOR: ExpressionSpecification = ["==", ["get", "kind"], "minor_road"];
// Ramps clutter interchanges at city scale.
const LINK: ExpressionSpecification = [
  "match",
  ["get", "kind_detail"],
  ["motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link"],
  true,
  false,
];

const source = { source: ORIENTATION_SOURCE } as const;

function water(): LayerSpecification[] {
  return [
    {
      id: "orientation-water",
      type: "fill",
      ...source,
      "source-layer": "water",
      filter: POLYGON,
      paint: { "fill-color": WATER, "fill-antialias": false },
    },
    // A shoreline, so that the rivers keep their shape where buildings meet the bank.
    {
      id: "orientation-shore",
      type: "line",
      ...source,
      "source-layer": "water",
      filter: POLYGON,
      minzoom: 12,
      paint: {
        "line-color": SHORE,
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.3, 16, 0.75],
      },
    },
    // Streams and ditches are lines in the source.
    {
      id: "orientation-streams",
      type: "line",
      ...source,
      "source-layer": "water",
      filter: LINE,
      minzoom: 13,
      paint: {
        "line-color": SHORE,
        "line-width": ["interpolate", ["linear"], ["zoom"], 13, 0.4, 16, 1],
      },
    },
  ];
}

function majorRoads(): LayerSpecification {
  return {
    id: "orientation-roads",
    type: "line",
    ...source,
    "source-layer": "roads",
    filter: ["all", MAJOR, ["any", ["!", LINK], [">=", ["zoom"], 13]]],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": ROAD,
      "line-width": [
        "interpolate",
        ["linear"],
        ["zoom"],
        10,
        ["case", HIGHWAY, 0.6, 0.3],
        14,
        ["case", HIGHWAY, 1.2, 0.8],
        17,
        ["case", HIGHWAY, 3, 2],
      ],
    },
  };
}

/** Streets fade in from zoom 13.5 to 15, where blocks are large enough to read. */
function minorRoads(): LayerSpecification {
  return {
    id: "orientation-streets",
    type: "line",
    ...source,
    "source-layer": "roads",
    filter: MINOR,
    minzoom: 13.5,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": STREET,
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 13.5, 0, 15, 1],
      "line-width": ["interpolate", ["linear"], ["zoom"], 14, 0.4, 17, 1.5],
    },
  };
}

/** The layers for a variant, in drawing order, for placement below the buildings. */
export function orientationLayers(variant: Variant): LayerSpecification[] {
  switch (variant) {
    case "water":
      return water();
    case "roads":
      return [...water(), majorRoads()];
    case "streets":
      return [...water(), minorRoads(), majorRoads()];
  }
}
