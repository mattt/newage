import { gzipSync, gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Compression, zxyToTileId } from "pmtiles";
import { handleTiles, type TilesEnv } from "./tiles";

const payload = new TextEncoder().encode("test vector tile");

function varint(value: number): number[] {
  const bytes: number[] = [];
  while (value >= 128) {
    bytes.push((value % 128) | 128);
    value = Math.floor(value / 128);
  }
  bytes.push(value);
  return bytes;
}

// A one-tile PMTiles v3 archive with gzip metadata and a gzip root directory.
function archive(compression: Compression): ArrayBuffer {
  const tile = compression === Compression.Gzip ? gzipSync(payload) : payload;
  const root = gzipSync(new Uint8Array([
    1, ...varint(zxyToTileId(10, 163, 366)), 1, ...varint(tile.length), 1,
  ]));
  const metadata = gzipSync(JSON.stringify({ vector_layers: [{ id: "buildings" }] }));
  const data = new Uint8Array(127 + root.length + metadata.length + tile.length);
  data.set(new TextEncoder().encode("PMTiles"));
  const view = new DataView(data.buffer);
  view.setUint8(7, 3);
  for (const [offset, value] of [
    [8, 127], [16, root.length], [24, 127 + root.length], [32, metadata.length],
    [56, 127 + root.length + metadata.length], [64, tile.length],
    [72, 1], [80, 1], [88, 1],
  ]) view.setBigUint64(offset, BigInt(value), true);
  data.set([1, Compression.Gzip, compression, 1, 10, 10], 96);
  data.set(root, 127);
  data.set(metadata, 127 + root.length);
  data.set(tile, 127 + root.length + metadata.length);
  return data.buffer;
}

function harness(name: string, compression: Compression) {
  const data = archive(compression);
  const get = vi.fn(async (_key: string, options: { range: { offset: number; length: number } }) => ({
    body: new ReadableStream(), etag: name,
    arrayBuffer: async () => data.slice(options.range.offset, options.range.offset + options.range.length),
  }));
  const env = { BUCKET: { get } } as unknown as TilesEnv;
  const saved = new Map<string, Response>();
  vi.stubGlobal("caches", { default: {
    match: async (key: Request) => saved.get(key.url)?.clone(),
    put: async (key: Request, response: Response) => { saved.set(key.url, response); },
  } });
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (promise: Promise<unknown>) => pending.push(promise) } as ExecutionContext;
  return {
    get,
    async request(path: string, init?: RequestInit) {
      const response = await handleTiles(new Request(`https://example.com/tiles/${name}${path}`, init), env, ctx);
      await Promise.all(pending.splice(0));
      return response;
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("overview tile responses", () => {
  it("keeps gzip bytes and headers through the cache, HEAD, and revalidation", async () => {
    const h = harness("gzip-overview", Compression.Gzip);
    const path = "/10/163/366.mvt?v=gzip-overview";
    for (let i = 0; i < 2; i++) {
      const response = await h.request(path);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Encoding")).toBe("gzip");
      expect(response.headers.get("Cache-Control")).toContain("immutable");
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect(bytes).toEqual(new Uint8Array(gzipSync(payload)));
      expect(new Uint8Array(gunzipSync(bytes))).toEqual(payload);
    }
    const reads = h.get.mock.calls.length;
    const head = await h.request(path, { method: "HEAD" });
    expect(head.headers.get("Content-Encoding")).toBe("gzip");
    expect(head.body).toBeNull();
    const fresh = await h.request(path, { headers: { "If-None-Match": head.headers.get("ETag")! } });
    expect(fresh.status).toBe(304);
    expect(fresh.body).toBeNull();
    expect(h.get.mock.calls.length).toBe(reads);
  });

  it("leaves uncompressed tiles unchanged and still decompresses TileJSON metadata", async () => {
    const h = harness("plain-overview", Compression.None);
    const response = await h.request("/10/163/366.mvt");
    expect(response.headers.has("Content-Encoding")).toBe(false);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(payload);
    const metadata = await (await h.request(".json")).json() as { vector_layers: unknown[]; maxzoom: number };
    expect(metadata.vector_layers).toEqual([{ id: "buildings" }]);
    expect(metadata.maxzoom).toBe(10);
  });

  it("does not attach gzip encoding to empty tiles", async () => {
    const h = harness("empty-overview", Compression.Gzip);
    const response = await h.request("/10/164/366.mvt");
    expect(response.status).toBe(204);
    expect(response.headers.has("Content-Encoding")).toBe(false);
    expect(response.body).toBeNull();
  });
});
