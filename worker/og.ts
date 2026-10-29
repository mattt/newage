import { OgBudget } from "./og-budget";
import { PMTiles } from "pmtiles";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { R2Source, nativeDecompress, type TilesEnv } from "./tiles";
import {
  cardSvg,
  metadata,
  parseSelection,
  tilePoint,
  type Selection,
  type Shape,
} from "./og-model";

export function archive(env: TilesEnv) {
  return new PMTiles(new R2Source(env, "portland_buildings"), undefined, nativeDecompress);
}
export async function loadShapes(
  p: Pick<PMTiles, "getZxy">,
  s: Selection,
  z: number,
): Promise<Shape[]> {
  const center = tilePoint(s.lat, s.lng, z);
  const scale = 512 * 2 ** (16 - z);
  const result: Shape[] = [];
  const radius = 330 / scale;
  for (let y = Math.floor(center.y - radius); y <= Math.floor(center.y + radius); y++) {
    for (let x = Math.floor(center.x - radius); x <= Math.floor(center.x + radius); x++) {
      const tile = await p.getZxy(z, x, y);
      if (!tile) continue;
      const layers = new VectorTile(new PbfReader(new Uint8Array(tile.data))).layers;
      for (const layer of Object.values(layers))
        for (let i = 0; i < layer.length; i++) {
          const f = layer.feature(i);
          if (f.type !== 3) continue;
          const year = Number(f.properties.year_built);
          result.push({
            id: String(f.properties.bldg_id ?? f.id ?? ""),
            year: Number.isInteger(year) && year >= 1700 && year <= 2100 ? year : null,
            rings: f
              .loadGeometry()
              .map((r) =>
                r.map((pt) => ({
                  x: 880 + (x + pt.x / layer.extent - center.x) * scale,
                  y: 315 + (y + pt.y / layer.extent - center.y) * scale,
                })),
              ),
          });
        }
    }
  }
  return result.filter((f) =>
    f.rings.some((r) => {
      const xs = r.map((p) => p.x),
        ys = r.map((p) => p.y);
      return (
        Math.max(...xs) >= 565 &&
        Math.min(...xs) <= 1205 &&
        Math.max(...ys) >= -5 &&
        Math.min(...ys) <= 635
      );
    }),
  );
}
export interface OgServices {
  archive: (env: TilesEnv) => Pick<PMTiles, "getHeader" | "getZxy">;
  loadShapes: typeof loadShapes;
  renderPng: (svg: string) => Promise<Uint8Array>;
  budget: OgBudget;
}

const cardServices: OgServices = {
  archive,
  loadShapes,
  renderPng: async (svg) => (await import("./og-render")).renderPng(svg),
  budget: new OgBudget(),
};

export async function handleOg(
  request: Request,
  env: TilesEnv,
  ctx: ExecutionContext,
  services = cardServices,
): Promise<Response> {
  const url = new URL(request.url),
    s = parseSelection(url);
  if (!s) return Response.redirect(new URL("/share.png", url.origin).href, 302);
  try {
    const p = services.archive(env),
      h = await p.getHeader();
    const epochRaw = url.searchParams.get("asof");
    const epoch =
      epochRaw && /^20\d{2}$/.test(epochRaw) ? Number(epochRaw) : new Date().getUTCFullYear();
    const m = metadata(new URL(`/${url.search}`, url.origin), h.etag ?? "", epoch)!;
    const key = new Request(m.image);
    const hit = await caches.default.match(key);
    if (hit) {
      const r = new Response(request.method === "HEAD" ? null : hit.body, hit);
      r.headers.set("X-OG-Cache", "HIT");
      if (url.searchParams.get("v") !== h.etag || epochRaw !== String(epoch))
        r.headers.set("Cache-Control", "public, max-age=300");
      return r;
    }
    const work = services.budget.run(key.url, async () => {
      const shapes = await services.loadShapes(p, s, Math.max(h.minZoom, Math.min(15, h.maxZoom)));
      const png = await services.renderPng(cardSvg(s, shapes, epoch));
      // Keep coalescing active until the immutable cache entry is stored.
      await caches.default.put(key, new Response(png as Uint8Array<ArrayBuffer>, {
        headers: {
          "Content-Type": "image/png",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      }));
      return png;
    });
    if (!work) {
      return new Response(null, {
        status: 302,
        headers: { Location: new URL("/share.png", url.origin).href, "Cache-Control": "no-store" },
      });
    }
    ctx.waitUntil(work.then(() => undefined, () => undefined));
    const png = await work;
    const versioned = url.searchParams.get("v") === h.etag && epochRaw === String(epoch);
    return new Response(request.method === "HEAD" ? null : png as Uint8Array<ArrayBuffer>, {
      headers: {
        "Content-Type": "image/png",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": versioned ? "public, max-age=31536000, immutable" : "public, max-age=300",
        "X-OG-Cache": "MISS",
      },
    });
  } catch (error) {
    console.error("Building card failed", error);
    return Response.redirect(new URL("/share.png", url.origin).href, 302);
  }
}
export async function rewriteHome(
  request: Request,
  env: TilesEnv & { ASSETS: Fetcher },
): Promise<Response> {
  const response = await env.ASSETS.fetch(request);
  const url = new URL(request.url);
  if (request.method !== "GET" || url.pathname !== "/" || !parseSelection(url) || !response.ok)
    return response;
  try {
    const h = await archive(env).getHeader();
    const m = metadata(url, h.etag ?? "", new Date().getUTCFullYear())!;
    const values: Record<string, string> = {
      "og:title": m.title,
      "twitter:title": m.title,
      "og:description": m.description,
      "twitter:description": m.description,
      "og:image": m.image,
      "twitter:image": m.image,
      "og:image:alt": m.description,
    };
    const rewriter = new HTMLRewriter().on("meta", {
      element(el) {
        const value = values[el.getAttribute("property") ?? el.getAttribute("name") ?? ""];
        if (value) el.setAttribute("content", value);
      },
    });
    const result = rewriter.transform(response);
    result.headers.delete("ETag");
    result.headers.set("Cache-Control", "no-store");
    return result;
  } catch (error) {
    console.error("Building metadata failed", error);
    return response;
  }
}
