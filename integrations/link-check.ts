import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";
import { selectAll } from "hast-util-select";
import rehypeParse from "rehype-parse";
import { unified } from "unified";

// After the build, reads every HTML file in dist/ and fails the build when an
// internal link points to a page without its trailing slash or to a path that
// the build did not write. Workers static assets answers a slashless page URL
// with a 307 redirect, so each such link costs a round trip.

/**
 * What is wrong with one href on the page at `page`, or null when nothing is.
 * `exists` says whether a path relative to dist/, such as "about/index.html",
 * is a built file. Links to other origins and other schemes are not checked.
 */
export function linkProblem(
  href: string,
  page: URL,
  exists: (file: string) => boolean,
): string | null {
  let url: URL;
  let path: string;
  try {
    url = new URL(href, page);
    path = decodeURIComponent(url.pathname);
  } catch {
    return "is not a valid URL";
  }
  if (url.origin !== page.origin) return null;
  const file = path.slice(1);
  // As in worker/index.ts, a last segment with a dot names a file.
  if (path.split("/").at(-1)?.includes(".")) return exists(file) ? null : "names a missing file";
  if (path.endsWith("/")) return exists(`${file}index.html`) ? null : "names a missing page";
  if (exists(`${file}/index.html`)) return "has no trailing slash";
  // A file without an extension, such as /.well-known/api-catalog.
  return exists(file) ? null : "names a missing page";
}

/** The URL that serves a built HTML file: "about/index.html" is /about/, "404.html" is /404.html. */
export function pageUrlFor(file: string, site: string): URL {
  return new URL(file.replace(/(^|\/)index\.html$/, "$1"), site);
}

export default function linkCheck(): AstroIntegration {
  let site = "";
  return {
    name: "link-check",
    hooks: {
      "astro:config:done": ({ config }) => {
        site = config.site ?? "";
      },
      "astro:build:done": async ({ dir, logger }) => {
        const root = fileURLToPath(dir);
        const exists = (file: string) => existsSync(new URL(file, dir));
        const files = (await readdir(root, { recursive: true }))
          .filter((file) => file.endsWith(".html"))
          .sort();
        const problems: string[] = [];
        let links = 0;
        for (const file of files) {
          const page = pageUrlFor(file, site);
          const tree = unified()
            .use(rehypeParse)
            .parse(await readFile(new URL(file, dir), "utf8"));
          for (const el of selectAll("[href]", tree)) {
            const href = String(el.properties.href);
            links++;
            const problem = linkProblem(href, page, exists);
            if (problem) problems.push(`  ${page.pathname}: ${href} ${problem}`);
          }
        }
        if (problems.length)
          throw new Error(
            `${problems.length} internal ${problems.length === 1 ? "link needs" : "links need"} fixing:\n${problems.join("\n")}`,
          );
        logger.info(`Checked ${links} links on ${files.length} HTML pages`);
      },
    },
  };
}
