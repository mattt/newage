import { handleTiles, TILES_PREFIX, type TilesEnv } from "./tiles";

interface Env extends TilesEnv {
  ASSETS: Fetcher;
  CANONICAL_HOST: string;
}

// MapLibre loads its worker from the same origin (maplibre-gl-worker.mjs),
// so the policy needs no blob: worker source.
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

// Files in versioned vendor directories, such as /vendor/maplibre-gl-6.16.0/,
// never change.
const VERSIONED_VENDOR = /^\/vendor\/[a-z0-9-]+-\d+\.\d+\.\d+[^/]*\//;

function withHeaders(response: Response, pathname: string): Response {
  const result = new Response(response.body, response);
  const headers = result.headers;
  headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Strict-Transport-Security", "max-age=31536000");
  if (VERSIONED_VENDOR.test(pathname) && result.ok) {
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
  }
  return result;
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);

    if (url.hostname === `www.${env.CANONICAL_HOST}`) {
      const target = `https://${env.CANONICAL_HOST}${url.pathname}${url.search}`;
      return new Response(null, { status: 308, headers: { Location: target } });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    }

    if (url.pathname.startsWith(TILES_PREFIX)) {
      return withHeaders(await handleTiles(request, env, ctx), url.pathname);
    }

    return withHeaders(await env.ASSETS.fetch(request), url.pathname);
  },
} satisfies ExportedHandler<Env>;
