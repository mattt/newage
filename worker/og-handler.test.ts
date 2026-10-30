import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { handleOg, type OgServices } from "./og";
import { OgBudget } from "./og-budget";

let store: Map<string, Response>;
let services: OgServices;
const ctx = { waitUntil: (_work: Promise<unknown>) => {} } as unknown as ExecutionContext;
const env = {} as Parameters<typeof handleOg>[1];
const request = (building = "test", method = "GET") => handleOg(
  new Request(`https://example.com/og/building.png?building=${building}&year=1978&lat=45.519148&lng=-122.680321`, { method }), env, ctx, services,
);
beforeEach(() => {
  store = new Map();
  vi.stubGlobal("caches", { default: {
    match: async (key: Request) => store.get(key.url)?.clone(),
    put: async (key: Request, response: Response) => { store.set(key.url, response); },
  } });
  services = {
    archive: vi.fn().mockReturnValue({
      getHeader: vi.fn().mockResolvedValue({ minZoom: 10, maxZoom: 16, etag: "archive" }),
    }),
    loadShapes: vi.fn().mockResolvedValue([]),
    renderPng: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    budget: new OgBudget(() => 0),
  };
});
afterEach(() => vi.unstubAllGlobals());

it("rejects over-budget renders before loading shapes and lets cache hits through", async () => {
  for (let i = 0; i < 6; i++) expect((await request(`test${i}`)).status).toBe(200);
  const limited = await request("limited");
  expect(limited.status).toBe(302);
  expect(limited.headers.get("Location")).toBe("https://example.com/share.png");
  expect(limited.headers.get("Cache-Control")).toBe("no-store");
  expect(services.loadShapes).toHaveBeenCalledTimes(6);
  expect(services.renderPng).toHaveBeenCalledTimes(6);
  expect((await request("test0")).headers.get("X-OG-Cache")).toBe("HIT");
  expect(services.loadShapes).toHaveBeenCalledTimes(6);
});

it("shares PNG bytes for identical concurrent misses and caps concurrency", async () => {
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  vi.mocked(services.renderPng).mockImplementation(async () => {
    await gate;
    return new Uint8Array([1, 2, 3]);
  });
  const first = request();
  const same = request();
  const other = request("other");
  expect((await request("third")).status).toBe(302);
  expect(services.loadShapes).toHaveBeenCalledTimes(2);
  finish();
  const [a, b] = await Promise.all([first, same, other]);
  expect(await a.arrayBuffer()).toEqual(await b.arrayBuffer());
  expect(services.renderPng).toHaveBeenCalledTimes(2);
});

it("returns independent GET and bodyless HEAD responses for cached and uncached cards", async () => {
  const head = await request("test", "HEAD");
  expect(head.status).toBe(200);
  expect(await head.text()).toBe("");
  expect(head.headers.get("Content-Type")).toBe("image/png");
  const get = await request();
  expect(new Uint8Array(await get.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  expect((await request("test", "HEAD")).headers.get("X-OG-Cache")).toBe("HIT");
  expect(services.renderPng).toHaveBeenCalledTimes(1);
});
