import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  handleGeocode,
  normalizeQuery,
  parseCoordinate,
  reverseLabel,
  searchLabel,
  searchResults,
} from "./geocode";
import worker from "./index";

// Trimmed from Photon's answer to "Powell's City of Books".
const powells = {
  type: "Feature",
  properties: {
    osm_key: "shop",
    osm_value: "books",
    type: "house",
    housenumber: "1005",
    name: "Powell's City of Books",
    street: "West Burnside Street",
    district: "Pearl District",
    city: "Portland",
    state: "Oregon",
    postcode: "97209",
  },
  geometry: { type: "Point", coordinates: [-122.6816396, 45.5233346] },
};

const house = {
  type: "Feature",
  properties: { housenumber: "1005", street: "West Burnside Street", city: "Portland" },
  geometry: { type: "Point", coordinates: [-122.6813969, 45.5230454] },
};

// Portland, Maine, which a query for a street name can also match.
const maine = {
  type: "Feature",
  properties: { name: "Burnside Avenue", city: "Portland", state: "Maine" },
  geometry: { type: "Point", coordinates: [-70.2553, 43.6591] },
};

const collection = (...features: unknown[]) => ({ type: "FeatureCollection", features });

describe("searchLabel", () => {
  it("joins the name, street address, and city", () => {
    expect(searchLabel(powells.properties)).toBe(
      "Powell's City of Books, 1005 West Burnside Street, Portland",
    );
    expect(searchLabel(house.properties)).toBe("1005 West Burnside Street, Portland");
  });

  it("uses the district for a place without a street, and skips repeated parts", () => {
    expect(
      searchLabel({ name: "Laurelhurst Park", district: "Laurelhurst", city: "Portland" }),
    ).toBe("Laurelhurst Park, Laurelhurst, Portland");
    expect(searchLabel({ name: "Portland", city: "Portland" })).toBe("Portland");
    expect(searchLabel({})).toBeNull();
  });
});

describe("searchResults", () => {
  it("keeps only labelled points inside the Portland area", () => {
    const results = searchResults(
      collection(maine, powells, { properties: {}, geometry: powells.geometry }, {
        properties: house.properties,
        geometry: { type: "LineString", coordinates: [] },
      }),
    );
    expect(results).toEqual([
      {
        label: "Powell's City of Books, 1005 West Burnside Street, Portland",
        lat: 45.5233346,
        lng: -122.6816396,
      },
    ]);
  });

  it("returns at most five results without repeated labels", () => {
    const many = Array.from({ length: 8 }, (_, index) => ({
      ...house,
      properties: { ...house.properties, housenumber: String(1000 + index) },
    }));
    expect(searchResults(collection(house, house, ...many))).toHaveLength(5);
    expect(searchResults(collection(house, house))).toHaveLength(1);
  });

  it("rejects a payload without a feature list", () => {
    expect(() => searchResults({ message: "error" })).toThrow();
    expect(() => searchResults(null)).toThrow();
  });
});

describe("reverseLabel", () => {
  it("returns the street address and drops the name", () => {
    expect(reverseLabel(collection(powells))).toBe("1005 West Burnside Street");
  });

  it("returns null without a house number or outside the Portland area", () => {
    expect(reverseLabel(collection({ ...house, properties: { street: "West Burnside Street" } })))
      .toBeNull();
    expect(
      reverseLabel(
        collection({ ...maine, properties: { housenumber: "1", street: "Burnside Avenue" } }),
      ),
    ).toBeNull();
    expect(reverseLabel(collection())).toBeNull();
  });
});

describe("normalizeQuery", () => {
  it("trims, joins white space, and lowercases", () => {
    expect(normalizeQuery("  1005  W\tBurnside St ")).toBe("1005 w burnside st");
  });

  it("rejects a missing, short, or long query", () => {
    expect(normalizeQuery(null)).toBeNull();
    expect(normalizeQuery("")).toBeNull();
    expect(normalizeQuery("  ab  ")).toBeNull();
    expect(normalizeQuery("a".repeat(121))).toBeNull();
    expect(normalizeQuery("a".repeat(120))).toHaveLength(120);
  });
});

describe("parseCoordinate", () => {
  it("rounds to 5 decimal places", () => {
    expect(parseCoordinate("45.5233346", 45, 46)).toBe(45.52333);
    expect(parseCoordinate("-122.681639", -123, -122)).toBe(-122.68164);
  });

  it("rejects a missing, malformed, or out-of-range value", () => {
    for (const value of [null, "", " ", "abc", "45.5x", "1e1", "Infinity", "0x2D", "47"]) {
      expect(parseCoordinate(value, 45, 46)).toBeNull();
    }
  });
});

describe("handleGeocode", () => {
  let store: Map<string, Response>;
  let pending: Promise<unknown>[];
  let fetchMock: ReturnType<typeof vi.fn>;

  const ctx = {
    waitUntil: (promise: Promise<unknown>) => pending.push(promise),
  } as unknown as ExecutionContext;

  const request = (path: string, method = "GET") =>
    handleGeocode(new Request(`https://example.com${path}`, { method }), ctx);

  const providerAnswers = (body: unknown, status = 200) =>
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));

  beforeEach(() => {
    store = new Map();
    pending = [];
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("caches", {
      default: {
        match: async (key: Request) => store.get(key.url)?.clone(),
        put: async (key: Request, response: Response) => {
          store.set(key.url, response);
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("searches Photon in the Portland area with an identifying User-Agent", async () => {
    providerAnswers(collection(maine, powells));
    const response = await request("/geocode/search?q=Powell%27s%20City%20of%20Books");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(await response.json()).toEqual({
      results: [
        {
          label: "Powell's City of Books, 1005 West Burnside Street, Portland",
          lat: 45.5233346,
          lng: -122.6816396,
        },
      ],
    });

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.origin).toBe("https://photon.komoot.io");
    expect(url.pathname).toBe("/api/");
    expect(url.searchParams.get("q")).toBe("powell's city of books");
    expect(url.searchParams.get("bbox")).toBe("-122.95,45.35,-122.25,45.72");
    expect(new Headers(init.headers).get("User-Agent")).toMatch(/ageofthe\.city/);
  });

  it("caches search results under the normalized query", async () => {
    providerAnswers(collection(powells));
    await request("/geocode/search?q=Powell%27s+City+of+Books");
    await Promise.all(pending);
    expect([...store.keys()]).toEqual([
      "https://example.com/geocode/search?q=powell%27s+city+of+books",
    ]);
    expect(store.values().next().value?.headers.get("Cache-Control")).toMatch(/max-age=\d{6,}/);

    const again = await request("/geocode/search?q=%20POWELL%27S%20%20city%20of%20books&x=1");
    expect(again.status).toBe(200);
    expect((await again.json()).results).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns a nonsense query's empty list", async () => {
    providerAnswers(collection());
    const response = await request("/geocode/search?q=zzqxqzv");
    expect(await response.json()).toEqual({ results: [] });
  });

  it("reverse geocodes a rounded point and caches it for nearby clicks", async () => {
    providerAnswers(collection(powells));
    const response = await request("/geocode/reverse?lat=45.5233346&lng=-122.6816396");
    expect(await response.json()).toEqual({ label: "1005 West Burnside Street" });
    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(url.pathname).toBe("/reverse");
    expect(url.searchParams.get("lat")).toBe("45.52333");
    expect(url.searchParams.get("lon")).toBe("-122.68164");
    await Promise.all(pending);
    expect([...store.keys()]).toEqual([
      "https://example.com/geocode/reverse?lat=45.52333&lng=-122.68164",
    ]);

    await request("/geocode/reverse?lng=-122.681641&lat=45.523331");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns a null label when Photon has no street address", async () => {
    providerAnswers(collection());
    const response = await request("/geocode/reverse?lat=45.5&lng=-122.6");
    expect(await response.json()).toEqual({ label: null });
  });

  it("rejects malformed requests with a 400 before it asks Photon", async () => {
    for (const path of [
      "/geocode/search",
      "/geocode/search?q=",
      "/geocode/search?q=%20%20ab",
      `/geocode/search?q=${"a".repeat(121)}`,
      "/geocode/reverse",
      "/geocode/reverse?lat=45.5",
      "/geocode/reverse?lat=abc&lng=-122.6",
      "/geocode/reverse?lat=40.7&lng=-74.0",
    ]) {
      const response = await request(path);
      expect(response.status, path).toBe(400);
      expect(response.headers.get("Content-Type")).toBe("application/json");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toHaveProperty("error");
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it("returns a 404 for another path", async () => {
    expect((await request("/geocode/forward?q=abc")).status).toBe(404);
  });

  it("returns an uncached 502 when Photon fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const fail of [
      () => providerAnswers({ message: "busy" }, 503),
      () => fetchMock.mockResolvedValue(new Response("<html>", { status: 200 })),
      () => providerAnswers({ message: "no features" }),
      () => fetchMock.mockRejectedValue(new TypeError("network down")),
    ]) {
      fail();
      const response = await request("/geocode/search?q=burnside");
      expect(response.status).toBe(502);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toHaveProperty("error");
    }
    await Promise.all(pending);
    expect(store.size).toBe(0);
  });

  it("answers HEAD without a body", async () => {
    providerAnswers(collection(powells));
    const response = await request("/geocode/search?q=powells", "HEAD");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.body).toBeNull();
  });

  it("is routed by the Worker with nosniff", async () => {
    const env = { CANONICAL_HOST: "example.com", ASSETS: { fetch: vi.fn() } };
    const response = await worker.fetch(
      new Request("https://example.com/geocode/search?q=a"),
      env as never,
      ctx,
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });
});
