// Assembles the static assets in dist/ from ../frontend
// and the MapLibre GL JS files in node_modules.
// The vendor directory name includes the MapLibre version,
// so the Worker can serve those files with an immutable Cache-Control header.

import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const frontend = join(root, "..", "frontend");
const dist = join(root, "dist");
const maplibre = join(root, "node_modules", "maplibre-gl");

const { version } = JSON.parse(readFileSync(join(maplibre, "package.json"), "utf8")) as {
  version: string;
};
const vendorDir = `vendor/maplibre-gl-${version}`;

rmSync(dist, { recursive: true, force: true });
cpSync(frontend, dist, { recursive: true });

mkdirSync(join(dist, vendorDir), { recursive: true });
for (const file of [
  "maplibre-gl.mjs",
  "maplibre-gl.mjs.map",
  "maplibre-gl-worker.mjs",
  "maplibre-gl-worker.mjs.map",
  "maplibre-gl.css",
]) {
  copyFileSync(join(maplibre, "dist", file), join(dist, vendorDir, file));
}

// Point the page at the versioned vendor directory.
for (const file of ["index.html", "app.js"]) {
  const path = join(dist, file);
  writeFileSync(path, readFileSync(path, "utf8").replaceAll("/vendor/maplibre-gl/", `/${vendorDir}/`));
}

console.log(`Built dist/ with MapLibre GL JS ${version}`);
