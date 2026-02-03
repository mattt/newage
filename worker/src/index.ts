import {
  Compression,
  EtagMismatch,
  PMTiles,
  ResolvedValueCache,
  Source,
  TileType,
} from "pmtiles";
import { pmtiles_path, tile_path } from "./shared";

interface Env {
  ALLOWED_ORIGINS?: string;
  BUCKET: R2Bucket;
  CACHE_CONTROL?: string;
  PMTILES_PATH?: string;
  PUBLIC_HOSTNAME?: string;
}

class KeyNotFoundError extends Error { }

async function nativeDecompress(
  buf: ArrayBuffer,
  compression: Compression
): Promise<ArrayBuffer> {
  if (compression === Compression.None || compression === Compression.Unknown) {
    return buf;
  }
  if (compression === Compression.Gzip) {
    const stream = new Response(buf).body;
    const result = stream?.pipeThrough(new DecompressionStream("gzip"));
    return new Response(result).arrayBuffer();
  }
  throw new Error("Compression method not supported");
}

const CACHE = new ResolvedValueCache(25, undefined, nativeDecompress);

class R2Source implements Source {
  env: Env;
  archiveName: string;

  constructor(env: Env, archiveName: string) {
    this.env = env;
    this.archiveName = archiveName;
  }

  getKey() {
    return this.archiveName;
  }

  async getBytes(
    offset: number,
    length: number,
    _signal?: AbortSignal,
    etag?: string
  ) {
    const resp = await this.env.BUCKET.get(
      pmtiles_path(this.archiveName, this.env.PMTILES_PATH),
      {
        range: { offset, length },
        onlyIf: { etagMatches: etag },
      }
    );
    if (!resp) {
      throw new KeyNotFoundError("Archive not found");
    }

    const o = resp as R2ObjectBody;
    if (!o.body) {
      throw new EtagMismatch();
    }

    const data = await o.arrayBuffer();
    return {
      data,
      etag: o.etag,
      cacheControl: o.httpMetadata?.cacheControl,
      expires: o.httpMetadata?.cacheExpiry?.toISOString(),
    };
  }
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    if (request.method.toUpperCase() === "POST") {
      return new Response(undefined, { status: 405 });
    }

    const url = new URL(request.url);
    const { ok, name, tile, ext } = tile_path(url.pathname);
    if (!ok) {
      return new Response("Invalid URL", { status: 404 });
    }

    const cache = caches.default;
    let allowedOrigin = "";
    if (typeof env.ALLOWED_ORIGINS !== "undefined") {
      for (const origin of env.ALLOWED_ORIGINS.split(",")) {
        if (origin === request.headers.get("Origin") || origin === "*") {
          allowedOrigin = origin;
        }
      }
    }

    const cached = await cache.match(request.url);
    if (cached) {
      const respHeaders = new Headers(cached.headers);
      if (allowedOrigin) respHeaders.set("Access-Control-Allow-Origin", allowedOrigin);
      respHeaders.set("Vary", "Origin");
      return new Response(cached.body, {
        headers: respHeaders,
        status: cached.status,
      });
    }

    const cacheableResponse = (
      body: ArrayBuffer | string | undefined,
      cacheableHeaders: Headers,
      status: number
    ) => {
      cacheableHeaders.set(
        "Cache-Control",
        env.CACHE_CONTROL || "public, max-age=86400"
      );

      const cacheable = new Response(body, {
        headers: cacheableHeaders,
        status,
      });

      ctx.waitUntil(cache.put(request.url, cacheable));

      const respHeaders = new Headers(cacheableHeaders);
      if (allowedOrigin) respHeaders.set("Access-Control-Allow-Origin", allowedOrigin);
      respHeaders.set("Vary", "Origin");
      return new Response(body, { headers: respHeaders, status });
    };

    const cacheableHeaders = new Headers();
    const source = new R2Source(env, name);
    const p = new PMTiles(source, CACHE, nativeDecompress);

    try {
      const header = await p.getHeader();

      if (!tile) {
        cacheableHeaders.set("Content-Type", "application/json");
        const tileJson = await p.getTileJson(
          `https://${env.PUBLIC_HOSTNAME || url.hostname}/${name}`
        );
        return cacheableResponse(JSON.stringify(tileJson), cacheableHeaders, 200);
      }

      if (tile[0] < header.minZoom || tile[0] > header.maxZoom) {
        return cacheableResponse(undefined, cacheableHeaders, 404);
      }

      for (const pair of [
        [TileType.Mvt, "mvt"],
        [TileType.Png, "png"],
        [TileType.Jpeg, "jpg"],
        [TileType.Webp, "webp"],
        [TileType.Avif, "avif"],
      ] as const) {
        if (header.tileType === pair[0] && ext !== pair[1]) {
          if (header.tileType === TileType.Mvt && ext === "pbf") {
            continue;
          }
          return cacheableResponse(
            `Bad request: requested .${ext} but archive has type .${pair[1]}`,
            cacheableHeaders,
            400
          );
        }
      }

      const tileData = await p.getZxy(tile[0], tile[1], tile[2]);

      switch (header.tileType) {
        case TileType.Mvt:
          cacheableHeaders.set("Content-Type", "application/x-protobuf");
          break;
        case TileType.Png:
          cacheableHeaders.set("Content-Type", "image/png");
          break;
        case TileType.Jpeg:
          cacheableHeaders.set("Content-Type", "image/jpeg");
          break;
        case TileType.Webp:
          cacheableHeaders.set("Content-Type", "image/webp");
          break;
      }

      if (tileData) {
        return cacheableResponse(tileData.data, cacheableHeaders, 200);
      }
      return cacheableResponse(undefined, cacheableHeaders, 204);
    } catch (error) {
      if (error instanceof KeyNotFoundError) {
        return cacheableResponse("Archive not found", cacheableHeaders, 404);
      }
      throw error;
    }
  },
};
