import { describe, expect, it } from "vite-plus/test";
import { linkProblem, pageUrlFor } from "./link-check";

const site = "https://example.com/";
const built = new Set([
  "index.html",
  "404.html",
  "about/index.html",
  "people/index.html",
  "people/ada/index.html",
  "search/index.html",
  "feed.xml",
  "downloads/data.csv",
  ".well-known/api-catalog",
]);
const exists = (file: string) => built.has(file);
const check = (href: string, page = "/people/") => linkProblem(href, new URL(page, site), exists);

describe("linkProblem", () => {
  it("accepts page links that end with a slash, before any query or fragment", () => {
    expect(check("/")).toBeNull();
    expect(check("/about/")).toBeNull();
    expect(check("/about/#team")).toBeNull();
    expect(check("/search/?q=ada#results")).toBeNull();
    expect(check("https://example.com/people/ada/")).toBeNull();
  });

  it("rejects page links without the trailing slash", () => {
    expect(check("/about")).toBe("has no trailing slash");
    expect(check("/about#team")).toBe("has no trailing slash");
    expect(check("/search?q=ada")).toBe("has no trailing slash");
    expect(check("https://example.com/people/ada")).toBe("has no trailing slash");
  });

  it("resolves relative paths against the page", () => {
    expect(check("ada/")).toBeNull();
    expect(check("ada")).toBe("has no trailing slash");
    expect(check("../../about/", "/people/ada/")).toBeNull();
    expect(check("#top")).toBeNull();
  });

  it("rejects links to pages and files the build did not write", () => {
    expect(check("/nope/")).toBe("names a missing page");
    expect(check("/nope")).toBe("names a missing page");
    expect(check("/404/")).toBe("names a missing page");
    expect(check("/downloads/missing.csv")).toBe("names a missing file");
  });

  it("accepts links to built files, with or without an extension", () => {
    expect(check("/feed.xml")).toBeNull();
    expect(check("/downloads/data.csv")).toBeNull();
    expect(check("/.well-known/api-catalog")).toBeNull();
    expect(check("#main", "/404.html")).toBeNull();
  });

  it("skips other origins and schemes", () => {
    expect(check("https://developer.mozilla.org/")).toBeNull();
    expect(check("http://example.com/about")).toBeNull();
    expect(check("mailto:hello@example.com")).toBeNull();
  });
});

describe("pageUrlFor", () => {
  it("maps each built HTML file to the URL that serves it", () => {
    expect(pageUrlFor("index.html", site).pathname).toBe("/");
    expect(pageUrlFor("people/ada/index.html", site).pathname).toBe("/people/ada/");
    expect(pageUrlFor("404.html", site).pathname).toBe("/404.html");
  });
});
