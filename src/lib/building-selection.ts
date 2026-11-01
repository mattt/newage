import type { ExpressionSpecification, FilterSpecification } from "maplibre-gl";

/** Overview tiles below this zoom carry only the construction year. */
export const SELECTION_MIN_ZOOM = 13;
export const BUILDING_ID: ExpressionSpecification = ["to-string", ["get", "bldg_id"]];

/** No selection, absent IDs, and empty IDs must never highlight a footprint. */
export function selectionFilter(id?: string): FilterSpecification {
  if (!id) return ["==", ["literal", 1], 0];
  return ["all", ["has", "bldg_id"], ["==", BUILDING_ID, id]];
}
