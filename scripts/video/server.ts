// Serves the render page, its TypeScript modules, MapLibre, and the PMTiles
// archives to headless Chromium, so that rendering needs no Worker or R2.
// TypeScript files are served with their types stripped; the modules the page
// imports from src/lib use only type imports from MapLibre.
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { stripTypeScriptTypes } from "node:module";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");

/** URL prefixes and the directories they serve, relative to the repository. */
const MOUNTS: Record<string, string> = {
  "/page/": "scripts/video/page",
  "/src/lib/": "src/lib",
  "/maplibre-gl/": "node_modules/maplibre-gl/dist",
  "/pmtiles/": "node_modules/pmtiles/dist",
};

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".ts": "text/javascript; charset=utf-8",
  ".json": "application/json",
};

export interface TileFiles {
  buildings: string;
  orientation: string;
}

export async function startServer(tiles: TileFiles): Promise<{ url: string; close: () => Promise<void> }> {
  const archives: Record<string, string> = {
    "/tiles/buildings.pmtiles": resolve(tiles.buildings),
    "/tiles/orientation.pmtiles": resolve(tiles.orientation),
  };
  for (const file of Object.values(archives)) await stat(file);

  const server = createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
      if (path === "/") return void (await sendFile(response, join(ROOT, "scripts/video/page/index.html")));
      if (archives[path]) return void (await sendRange(response, archives[path], request.headers.range));
      for (const [prefix, directory] of Object.entries(MOUNTS)) {
        if (!path.startsWith(prefix)) continue;
        const base = join(ROOT, directory);
        const file = normalize(join(base, path.slice(prefix.length)));
        if (!file.startsWith(base)) break;
        return void (await sendFile(response, file));
      }
      response.writeHead(404).end();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 500;
      if (code === 500) console.error(error);
      if (!response.headersSent) response.writeHead(code);
      response.end();
    }
  });

  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise((done) => server.close(() => done())),
  };
}

async function sendFile(response: ServerResponse, file: string) {
  const type = TYPES[extname(file)] ?? "application/octet-stream";
  let body: string | Buffer = await readFile(file);
  if (extname(file) === ".ts") body = stripTypeScriptTypes(body.toString("utf8"));
  response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
  response.end(body);
}

/** PMTiles reads archives with HTTP range requests. */
async function sendRange(response: ServerResponse, file: string, range: string | undefined) {
  const { size } = await stat(file);
  const match = range ? /^bytes=(\d+)-(\d*)$/.exec(range) : null;
  if (!match) {
    response.writeHead(200, { "Content-Length": size, "Accept-Ranges": "bytes" });
    createReadStream(file).pipe(response);
    return;
  }
  const start = Number(match[1]);
  const end = Math.min(size - 1, match[2] ? Number(match[2]) : size - 1);
  if (start > end) {
    response.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
    return;
  }
  response.writeHead(206, {
    "Content-Length": end - start + 1,
    "Content-Range": `bytes ${start}-${end}/${size}`,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  });
  createReadStream(file, { start, end }).pipe(response);
}
