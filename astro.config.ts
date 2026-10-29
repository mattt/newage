import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";
import linkCheck from "./integrations/link-check.ts";

// Static output with one URL form for every page: /about/ is about/index.html,
// and every internal link ends in a slash. Workers static assets answers the
// other form with a 307, and the link check fails the build on such a link.
// No UI framework integration: the one interactive element is the MapLibre
// map, which src/scripts/map.ts drives directly.
export default defineConfig({
  site: "https://ageofthe.city",
  output: "static",
  trailingSlash: "always",
  build: {
    format: "directory",
    // The Content Security Policy in public/_headers allows styles only
    // from this origin, so never inline a stylesheet into the HTML.
    inlineStylesheets: "never",
  },
  integrations: [sitemap(), linkCheck()],
});
