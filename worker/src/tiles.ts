import {
  Compression,
  EtagMismatch,
  PMTiles,
  ResolvedValueCache,
  Source,
  TileType,
} from "pmtiles";
import { pmtiles_path, tile_path } from "./shared";

export interface TilesEnv {
  BUCKET: R2Bucket;
  PMTILES_PATH?: string;
}

export const TILES_PREFIX = "/tiles/";

// Tile URLs from the TileJSON carry the archive's ETag as `?v=`.
// When a new archive replaces the old one, the TileJSON changes,
// and the browser requests new URLs; so versioned tiles never change.
const IMMUTABLE = "public, max-age=31536000, immutable";
const UNVERSIONED = "public, max-age=3600";
const TILEJSON = "public, max-age=300";
const ERROR = "public, max-age=60";

const ARCHIVE_NAME = /^[A-Za-z0-9_-]+$/;

class KeyNotFoundError extends Error {}

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
  env: TilesEnv;
  archiveName: string;

  constructor(env: TilesEnv, archiveName: string) {
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

const CONTENT_TYPES: Partial<Record<TileType, [ext: string, type: string]>> = {
  [TileType.Mvt]: ["mvt", "application/x-protobuf"],
  [TileType.Png]: ["png", "image/png"],
  [TileType.Jpeg]: ["jpg", "image/jpeg"],
  [TileType.Webp]: ["webp", "image/webp"],
  [TileType.Avif]: ["avif", "image/avif"],
};

function text(body: string, status: number, cacheControl = ERROR): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": cacheControl,
    },
  });
}

async function buildResponse(
  url: URL,
  env: TilesEnv
): Promise<Response> {
  const { ok, name, tile, ext } = tile_path(url.pathname.slice(TILES_PREFIX.length));
  if (!ok || !ARCHIVE_NAME.test(name)) {
    return text("Not found", 404);
  }

  const p = new PMTiles(new R2Source(env, name), CACHE, nativeDecompress);
  let header;
  try {
    header = await p.getHeader();
  } catch (error) {
    if (error instanceof KeyNotFoundError) {
      return text("Archive not found", 404);
    }
    throw error;
  }
  const version = header.etag ?? "";

  if (!tile) {
    const [tileExt] = CONTENT_TYPES[header.tileType] ?? [""];
    const tileJson = (await p.getTileJson(`${url.origin}${TILES_PREFIX}${name}`)) as {
      tiles: string[];
    };
    const query = version ? `?v=${encodeURIComponent(version)}` : "";
    tileJson.tiles = [`${url.origin}${TILES_PREFIX}${name}/{z}/{x}/{y}.${tileExt}${query}`];
    return new Response(JSON.stringify(tileJson), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": TILEJSON,
        ETag: `"${version}"`,
      },
    });
  }

  const [z, x, y] = tile;
  if (z < header.minZoom || z > header.maxZoom || x >= 2 ** z || y >= 2 ** z) {
    return text("Tile out of range", 404);
  }

  const contentType = CONTENT_TYPES[header.tileType];
  if (!contentType) {
    return text("Unsupported tile type", 404);
  }
  const [archiveExt, type] = contentType;
  if (ext !== archiveExt && !(archiveExt === "mvt" && ext === "pbf")) {
    return text(`Not found: this archive has .${archiveExt} tiles`, 404);
  }

  const headers = new Headers({
    "Content-Type": type,
    "Cache-Control": version && url.searchParams.get("v") === version ? IMMUTABLE : UNVERSIONED,
    ETag: `"${version}-${z}-${x}-${y}"`,
  });

  const tileData = await p.getZxy(z, x, y);
  if (!tileData) {
    // No tile at this position: an empty tile, which MapLibre draws as nothing.
    return new Response(null, { status: 204, headers });
  }
  return new Response(tileData.data, { headers });
}

/** Serves `/tiles/{name}.json` (TileJSON) and `/tiles/{name}/{z}/{x}/{y}.{ext}`. */
export async function handleTiles(
  request: Request,
  env: TilesEnv,
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);

  // Ignore query parameters other than the archive version.
  const cacheUrl = new URL(url.pathname, url.origin);
  const v = url.searchParams.get("v");
  if (v) cacheUrl.searchParams.set("v", v);
  const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });

  const cache = caches.default;
  let response = await cache.match(cacheKey);
  if (!response) {
    try {
      response = await buildResponse(cacheUrl, env);
    } catch (error) {
      console.error("Tile request failed", cacheUrl.pathname, error);
      return text("Tile request failed", 502, "no-store");
    }
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  }

  const etag = response.headers.get("ETag");
  if (etag && request.headers.get("If-None-Match") === etag) {
    const headers = new Headers();
    for (const name of ["ETag", "Cache-Control"]) {
      const value = response.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(null, { status: 304, headers });
  }

  if (request.method === "HEAD") {
    return new Response(null, response);
  }
  return response;
}
