import { describe, expect, it } from "vite-plus/test";
import worker, { isPagePath, slashRedirect } from "./index";

const redirect = (path: string) => slashRedirect(new URL(`https://example.com${path}`));

describe("isPagePath", () => {
  it("treats a last segment with a dot as a file", () => {
    expect(isPagePath("/")).toBe(true);
    expect(isPagePath("/about")).toBe(true);
    expect(isPagePath("/about/")).toBe(true);
    expect(isPagePath("/feed.xml")).toBe(false);
    expect(isPagePath("/_astro/a.css")).toBe(false);
  });
});

describe("slashRedirect", () => {
  it("redirects a page path permanently to its trailing-slash URL, keeping the query", () => {
    const about = redirect("/about");
    expect(about?.status).toBe(308);
    expect(about?.headers.get("Location")).toBe("https://example.com/about/");
    expect(redirect("/people/ada?x=1")?.headers.get("Location")).toBe(
      "https://example.com/people/ada/?x=1",
    );
  });

  it("leaves the home page, slashed pages, and files alone", () => {
    for (const path of ["/", "/about/", "/feed.xml", "/_astro/a.css"])
      expect(redirect(path)).toBeNull();
  });

  it("keeps the redirect on this origin for a path that starts with two slashes", () => {
    expect(redirect("//example%2Ecom")?.headers.get("Location")).toBe(
      "https://example.com//example%2Ecom/",
    );
  });
});

describe("fetch", () => {
  const env = {
    CANONICAL_HOST: "example.com",
    ASSETS: {
      fetch: async (request: Request) =>
        new Response(new URL(request.url).pathname, { headers: { ETag: '"a"' } }),
    },
  };

  // The Worker needs a full Env at runtime; these tests exercise only the
  // paths that read CANONICAL_HOST and ASSETS.
  const fetchWorker = (request: Request, overrides = {}) =>
    worker.fetch(request, { ...env, ...overrides } as never, {} as never);

  it("redirects www to the canonical host with a 308", async () => {
    const response = await fetchWorker(new Request("https://www.example.com/about/?x=1"));
    expect(response.status).toBe(308);
    expect(response.headers.get("Location")).toBe("https://example.com/about/?x=1");
  });

  it("rejects methods other than GET and HEAD", async () => {
    const response = await fetchWorker(new Request("https://example.com/", { method: "POST" }));
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET, HEAD");
  });

  it("redirects a slashless page path before it fetches any asset", async () => {
    const response = await fetchWorker(new Request("https://example.com/about?x=1"), {
      ASSETS: {
        fetch: async (): Promise<Response> => {
          throw new Error("unexpected asset fetch");
        },
      },
    });
    expect(response.status).toBe(308);
    expect(response.headers.get("Location")).toBe("https://example.com/about/?x=1");
  });

  it("returns the asset response unchanged", async () => {
    const response = await fetchWorker(new Request("https://example.com/about/"));
    expect(response.status).toBe(200);
    expect(response.headers.get("ETag")).toBe('"a"');
    expect(await response.text()).toBe("/about/");
  });
});
