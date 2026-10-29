import { GEOCODE_PREFIX, handleGeocode } from "./geocode";
import { handleTiles, TILES_PREFIX, type TilesEnv } from "./tiles";

// Serves the Astro build in dist/ and the PMTiles archive in R2 at the same
// origin. wrangler.jsonc runs this Worker first for every request. Responses
// from env.ASSETS.fetch get the security and caching rules in
// public/_headers, matched on the request URL, so pass them through
// unchanged: Cloudflare turns their strong ETag into a weak one when it
// compresses them, and browsers revalidate with it. A response that the
// Worker builds itself, such as a redirect or a tile, does not get them.

interface Env extends TilesEnv {
  ASSETS: Fetcher;
  CANONICAL_HOST: string;
}

/** A page path has no dot in its last segment; "/feed.xml" names a file. */
export function isPagePath(pathname: string): boolean {
  return !pathname.split("/").at(-1)?.includes(".");
}

// "/about?x=1" redirects permanently to "/about/?x=1", the page's canonical URL.
// The assets would answer with a 307, which search engines treat as temporary.
// Every page path redirects, whether or not the page exists, so a missing page
// reaches the 404 page one hop later.
export function slashRedirect(url: URL): Response | null {
  if (url.pathname.endsWith("/") || !isPagePath(url.pathname)) return null;
  // An absolute Location keeps a path such as "//example" on this origin.
  const location = new URL(url);
  location.pathname = `${url.pathname}/`;
  return Response.redirect(location.href, 308);
}

function withNosniff(response: Response): Response {
  const result = new Response(response.body, response);
  result.headers.set("X-Content-Type-Options", "nosniff");
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
      return withNosniff(
        new Response("Method not allowed", {
          status: 405,
          headers: { Allow: "GET, HEAD" },
        })
      );
    }

    if (url.pathname.startsWith(GEOCODE_PREFIX)) {
      return withNosniff(await handleGeocode(request, ctx));
    }

    if (url.pathname.startsWith(TILES_PREFIX)) {
      return withNosniff(await handleTiles(request, env, ctx));
    }

    return slashRedirect(url) ?? env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
