import { formatCoordinate } from "./building";

/** The building that a share URL selects. */
export interface SharedBuilding {
  bldgId: string;
  /** The year built, or null when it is unknown. */
  yearBuilt: number | null;
  lat: number;
  lng: number;
}

/**
 * Builds the share URL for a building:
 * /?building={bldg_id}&year={year_built or "unknown"}&lat={lat}&lng={lng},
 * with the coordinates rounded to six decimals,
 * followed by the map position fragment, such as "#map=17/45.5/-122.6".
 * Other agents and pages depend on this form, so keep it.
 */
export function shareUrl(base: string | URL, building: SharedBuilding, hash = ""): string {
  const url = new URL("/", base);
  const params = new URLSearchParams({
    building: building.bldgId,
    year: building.yearBuilt === null ? "unknown" : String(building.yearBuilt),
    lat: formatCoordinate(building.lat),
    lng: formatCoordinate(building.lng),
  });
  url.search = params.toString();
  url.hash = hash;
  return url.href;
}

/**
 * Reads a building from share URL query parameters.
 * Returns null unless building, lat, and lng are all present and valid.
 */
export function parseShareParams(search: string | URLSearchParams): SharedBuilding | null {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const bldgId = params.get("building")?.trim();
  const lat = parseCoordinate(params.get("lat"), 90);
  const lng = parseCoordinate(params.get("lng"), 180);
  if (!bldgId || lat === null || lng === null) return null;

  const year = Number(params.get("year"));
  const yearBuilt = Number.isInteger(year) && year > 0 ? year : null;
  return { bldgId, yearBuilt, lat, lng };
}

function parseCoordinate(value: string | null, limit: number): number | null {
  if (value === null || value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
}
