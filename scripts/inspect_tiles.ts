// Usage: node scripts/inspect_tiles.ts data/portland_buildings.pmtiles
// Counts tile records, including copies in tile buffers and clipped pieces.
import { open, stat } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { Compression, PMTiles, tileIdToZxy, type Entry } from "pmtiles";

const path = process.argv[2];
if (!path) throw new Error("Supply a PMTiles path");
const file = await open(path, "r");
try {
  const source = {
    getKey: () => path,
    async getBytes(offset: number, length: number) {
      const data = Buffer.alloc(length);
      await file.read(data, 0, length, offset);
      return { data: data.buffer };
    },
  };
  const archive = new PMTiles(source);
  const header = await archive.getHeader();
  const metadata = await archive.getMetadata();
  const entries: Entry[] = [];
  async function directory(offset: number, length: number) {
    for (const entry of await archive.cache.getDirectory(source, offset, length, header)) {
      if (entry.runLength) entries.push(entry);
      else await directory(header.leafDirectoryOffset + entry.offset, entry.length);
    }
  }
  await directory(header.rootDirectoryOffset, header.rootDirectoryLength);
  const zooms = new Map<number, { sizes: number[]; records: number }>();
  for (const entry of entries) {
    const compressed = await source.getBytes(header.tileDataOffset + entry.offset, entry.length);
    const tile = new VectorTile(new PbfReader(
      header.tileCompression === Compression.Gzip
        ? gunzipSync(compressed.data) : new Uint8Array(compressed.data),
    ));
    const records = Object.values(tile.layers).reduce((sum, layer) => sum + layer.length, 0);
    for (let i = 0; i < entry.runLength; i++) {
      const [z] = tileIdToZxy(entry.tileId + i);
      const row = zooms.get(z) ?? { sizes: [], records: 0 };
      row.sizes.push(entry.length);
      row.records += records;
      zooms.set(z, row);
    }
  }
  const rows = [...zooms].sort(([a], [b]) => a - b).map(([zoom, { sizes, records }]) => {
    sizes.sort((a, b) => a - b);
    const mid = Math.floor(sizes.length / 2);
    return {
      zoom, tiles: sizes.length, records,
      medianBytes: sizes.length % 2 ? sizes[mid] : (sizes[mid - 1] + sizes[mid]) / 2,
      maxBytes: sizes.at(-1),
    };
  });
  console.log(JSON.stringify({ path, archiveBytes: (await stat(path)).size, rows, metadata }, null, 2));
} finally {
  await file.close();
}
