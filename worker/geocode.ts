import { GeocodeBudget } from "./geocode-budget";

const providerBudget = new GeocodeBudget();

// Address search and reverse geocoding for the map, through Photon
// (https://photon.komoot.io), which geocodes OpenStreetMap data.
// The Content Security Policy allows connections only to this origin,
// so the browser asks this Worker, and the Worker asks Photon.
//
// Photon, not Nominatim: the search box looks up addresses as the user types,
// and the Nominatim usage policy forbids autocomplete search on its servers
// (https://operations.osmfoundation.org/policies/nominatim/).
// Photon is built for search as you type, and its demo server welcomes
// projects that keep to a reasonable number of requests
// (https://github.com/komoot/photon#demo-server).
// To keep to that, the Worker caches every answer for a long time,
// and sends a User-Agent that identifies the site.
// Both services require attribution to OpenStreetMap contributors,
// which the search panel shows with its results.

export const GEOCODE_PREFIX = "/geocode/";

const PHOTON = "https://photon.komoot.io";
const USER_AGENT = "ageofthe.city (https://ageofthe.city/)";

/** The Portland area. Photon gets it as a filter, and the Worker checks it again. */
export const BOUNDS = { west: -122.95, south: 45.35, east: -122.25, north: 45.72 };

export const MAX_QUERY_LENGTH = 120;
export const MIN_QUERY_LENGTH = 3;
export const MAX_RESULTS = 5;

// Ask for more results than the panel shows, because some can fall outside BOUNDS.
const PROVIDER_LIMIT = 10;

// Reverse lookups search this far (in kilometers) from the point.
const REVERSE_RADIUS_KM = 0.05;
const PROVIDER_TIMEOUT_MS = 8000;

// Addresses change rarely, so answers stay in the cache for 30 days.
const CACHED = "public, max-age=2592000";
const NO_STORE = "no-store";

export interface SearchResult {
  label: string;
  lat: number;
  lng: number;
}

/** The parts of a Photon GeoJSON feature that the Worker reads. */
interface PhotonFeature {
  geometry?: { type?: string; coordinates?: unknown };
  properties?: Record<string, unknown>;
}

class ProviderError extends Error {}

function json(body: unknown, status: number, cacheControl: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": cacheControl },
  });
}

const badRequest = (message: string) => json({ error: message }, 400, NO_STORE);

/**
 * Trims the query, joins runs of white space, and lowercases it,
 * so that queries that differ only in case or spacing share one cache entry.
 * Returns null when the query is missing, too short, or too long.
 */
export function normalizeQuery(q: string | null): string | null {
  if (q === null) return null;
  const query = q.trim().replace(/\s+/g, " ").toLowerCase();
  if (query.length < MIN_QUERY_LENGTH || query.length > MAX_QUERY_LENGTH) return null;
  return query;
}

const DECIMAL = /^-?\d{1,3}(\.\d+)?$/;

/**
 * Parses a coordinate inside BOUNDS and rounds it to 5 decimal places,
 * about a meter, so that nearby clicks share one cache entry.
 * Returns null when the value is missing, malformed, or outside BOUNDS.
 */
export function parseCoordinate(
  value: string | null,
  min: number,
  max: number,
): number | null {
  if (value === null || !DECIMAL.test(value.trim())) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) return null;
  return Math.round(number * 1e5) / 1e5;
}

export function inBounds(lng: number, lat: number): boolean {
  return (
    lng >= BOUNDS.west && lng <= BOUNDS.east && lat >= BOUNDS.south && lat <= BOUNDS.north
  );
}

function text(properties: Record<string, unknown>, name: string): string | null {
  const value = properties[name];
  if (typeof value !== "string" && typeof value !== "number") return null;
  const result = String(value).trim();
  return result === "" ? null : result;
}

/** A street address, such as "1005 West Burnside Street", or null without a house number. */
export function streetAddress(properties: Record<string, unknown>): string | null {
  const number = text(properties, "housenumber");
  const street = text(properties, "street");
  return number && street ? `${number} ${street}` : null;
}

/**
 * A one-line label for a search result, such as
 * "Powell's City of Books, 1005 West Burnside Street, Portland".
 */
export function searchLabel(properties: Record<string, unknown>): string | null {
  const street = streetAddress(properties) ?? text(properties, "street");
  const parts = [
    text(properties, "name"),
    street,
    // A place without a street, such as a park, is easier to tell apart by its district.
    street ? null : text(properties, "district"),
    text(properties, "city"),
  ];
  const unique: string[] = [];
  for (const part of parts) {
    if (part && !unique.some((seen) => seen.toLowerCase() === part.toLowerCase())) {
      unique.push(part);
    }
  }
  return unique.length > 0 ? unique.join(", ") : null;
}

function point(feature: PhotonFeature): [lng: number, lat: number] | null {
  const coordinates = feature.geometry?.coordinates;
  if (feature.geometry?.type !== "Point" || !Array.isArray(coordinates)) return null;
  const [lng, lat] = coordinates;
  if (typeof lng !== "number" || typeof lat !== "number") return null;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [lng, lat];
}

function features(payload: unknown): PhotonFeature[] {
  const list = (payload as { features?: unknown } | null)?.features;
  if (!Array.isArray(list)) throw new ProviderError("Photon sent no feature list");
  return list.filter((feature): feature is PhotonFeature => typeof feature === "object" && feature !== null);
}

/** Up to MAX_RESULTS labelled points inside BOUNDS, without repeated labels. */
export function searchResults(payload: unknown): SearchResult[] {
  const results: SearchResult[] = [];
  for (const feature of features(payload)) {
    const position = point(feature);
    if (!position || !inBounds(...position)) continue;
    const label = searchLabel(feature.properties ?? {});
    if (!label || results.some((result) => result.label === label)) continue;
    results.push({ label, lat: position[1], lng: position[0] });
    if (results.length === MAX_RESULTS) break;
  }
  return results;
}

/** The street address of the first feature inside BOUNDS, or null. */
export function reverseLabel(payload: unknown): string | null {
  for (const feature of features(payload)) {
    const position = point(feature);
    if (!position || !inBounds(...position)) continue;
    const label = streetAddress(feature.properties ?? {});
    if (label) return label;
  }
  return null;
}

async function photon(path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(path, PHOTON);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!response.ok) throw new ProviderError(`Photon answered ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new ProviderError("Photon sent malformed JSON");
  }
}

type Lookup = { cacheUrl: URL; load: () => Promise<unknown> } | Response;

function lookup(url: URL): Lookup {
  const cacheUrl = new URL(url.pathname, url.origin);

  if (url.pathname === `${GEOCODE_PREFIX}search`) {
    const raw = url.searchParams.get("q");
    if (raw !== null && raw.length > MAX_QUERY_LENGTH) return badRequest("The query is too long.");
    const q = normalizeQuery(raw);
    if (q === null) {
      return badRequest(`The query needs at least ${MIN_QUERY_LENGTH} characters.`);
    }
    cacheUrl.searchParams.set("q", q);
    return {
      cacheUrl,
      load: async () => ({
        results: searchResults(
          await photon("/api/", {
            q,
            limit: String(PROVIDER_LIMIT),
            lang: "en",
            bbox: [BOUNDS.west, BOUNDS.south, BOUNDS.east, BOUNDS.north].join(","),
          }),
        ),
      }),
    };
  }

  if (url.pathname === `${GEOCODE_PREFIX}reverse`) {
    const lat = parseCoordinate(url.searchParams.get("lat"), BOUNDS.south, BOUNDS.north);
    const lng = parseCoordinate(url.searchParams.get("lng"), BOUNDS.west, BOUNDS.east);
    if (lat === null || lng === null) {
      return badRequest("The lat and lng parameters need a point in the Portland area.");
    }
    cacheUrl.searchParams.set("lat", lat.toFixed(5));
    cacheUrl.searchParams.set("lng", lng.toFixed(5));
    return {
      cacheUrl,
      load: async () => ({
        label: reverseLabel(
          await photon("/reverse", {
            lat: String(lat),
            lon: String(lng),
            limit: "1",
            radius: String(REVERSE_RADIUS_KM),
            lang: "en",
          }),
        ),
      }),
    };
  }

  return json({ error: "Not found" }, 404, NO_STORE);
}

/** Serves `/geocode/search?q=` and `/geocode/reverse?lat=&lng=`. */
export async function handleGeocode(request: Request, ctx: ExecutionContext, budget = providerBudget): Promise<Response> {
  const found = lookup(new URL(request.url));
  if (found instanceof Response) return found;

  const cacheKey = new Request(found.cacheUrl.toString(), { method: "GET" });
  const cache = caches.default;
  let response = await cache.match(cacheKey);
  if (!response) {
    try {
      const work = budget.run(cacheKey.url, async () => {
        const body = JSON.stringify(await found.load());
        // Keep coalescing active until the cache write finishes.
        await cache.put(cacheKey, new Response(body, {
          headers: { "Content-Type": "application/json", "Cache-Control": CACHED },
        }));
        return body;
      });
      if (!work) {
        const limited = json({ error: "Too many address lookups. Try again shortly." }, 429, NO_STORE);
        limited.headers.set("Retry-After", "3");
        return limited;
      }
      ctx.waitUntil(work.then(() => undefined, () => undefined));
      response = new Response(await work, {
        headers: { "Content-Type": "application/json", "Cache-Control": CACHED },
      });
    } catch (error) {
      console.error("Geocoding request failed", found.cacheUrl.pathname, error);
      return json({ error: "The geocoding service is unavailable." }, 502, NO_STORE);
    }
  }

  if (request.method === "HEAD") {
    return new Response(null, response);
  }
  return response;
}
