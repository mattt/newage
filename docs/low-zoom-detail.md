# Building detail at low zoom

Measured on November 1, 2026, using the published October 30 regional input:
749,294 footprints, Tippecanoe 2.79.0, and the repository's MapLibre 6.16.0.
The original input and archive were symlinked into the worktree for reading.
All candidate outputs were written to separate files.

## Recommendation

Keep full properties and separate footprints at every zoom.
Use 14-bit coordinates at zooms 10 through 13 and 12-bit coordinates at zooms
14 through 16, then join the two archives into one `buildings` layer.
Disable tiny-polygon reduction and the feature-count limit.
Set a 10,000,000-byte compressed tile limit and fix minimum coordinate precision.
A build that exceeds the limit fails instead of dropping buildings or reducing
coordinate precision.

This restores the dense field of color without changing the map style,
year filter, selection logic, or share-link format.
The Worker passes stored gzip tile bodies to the browser.
Archive indexes and TileJSON metadata still use normal decompression.
The Cache API write and response paths explicitly preserve manual encoding.
This avoids additional gzip layers on cached responses.
See the [Workers Response documentation](https://developers.cloudflare.com/workers/runtime-apis/response/)
for the `encodeBody` setting.

The cost is a larger archive and larger individual downloads.
The implemented archive is 183,549,114 bytes, compared with 116,018,495 bytes
for the published archive, an increase of 58.2 percent.
The largest tile is 8,825,975 bytes compressed and 30,910,164 bytes expanded.
Desktop animation and local loading were measured; mobile devices and slow
networks were not tested.
Those remain publication checks if this transfer size is acceptable.
No archive was uploaded to remote R2 and no site was deployed.

## Candidates

- The published archive uses `--drop-densest-as-needed` with full properties
  and default tiny-polygon reduction.
- The default-precision candidate keeps full properties, disables tiny-polygon
  reduction and both size/count limits, and uses default coordinate precision.
- The 14-bit overview candidate uses the same retention settings with
  `--full-detail=14 --low-detail=14 --minimum-detail=14` at zooms 10 through 13.
- The lean candidate keeps only `year_built` at zooms 10 through 13 with the
  same 14-bit geometry and retention settings.
  It has the same geometry record counts as the full-property overview.
  In the existing app, missing IDs match the empty highlight filter,
  producing white outlines across the map.
  IDs, popup details, and building share links are also missing at those zooms.
  A usable lean layer would need a separate selection/details path.
- The implemented build uses the full-property 14-bit overview and rebuilds
  zooms 14 through 16 with tiny-polygon reduction disabled.
  It also uses the corrected gzip Worker response path.

The first three completed candidates reused the published zooms 14 through 16
with `pmtiles extract` and `pmtiles merge` for controlled comparisons.
The implemented script rebuilds both ranges and uses `tile-join`.
This accounts for its small high-zoom size/count differences.

A year-only `--coalesce-densest-as-needed` build with default limits and
precision was stopped after ten minutes without a completed zoom-10 output.
The partial archive is unusable, so it has no tile measurements or screenshots.
Coalescing can also assign one feature's properties to other geometry,
which conflicts with per-building colors and exact-year filtering.
See [Tippecanoe's coalescing and tiny-polygon documentation](https://github.com/felt/tippecanoe#dropping-a-fraction-of-features-to-keep-under-tile-size-limits).

A raster overview was not built because preserved vector tiles met the visual
goal and retained the year filter.
A fixed raster cannot follow that filter.

## Features and tile sizes

These are decoded MVT feature records kept across all addressed tiles.
They include clipped pieces and copies in tile buffers, so they can exceed
749,294 and must not be read as unique source footprint counts.
The published archive has no unique per-footprint ID; source building labels
can repeat.
Its `strategies` counters and decoded records measure different things.
Neither establishes a unique retained footprint count without a per-footprint key.
At zoom 10 the archive contains 12,875 decoded records.
The implemented build has no configured feature dropping or coalescing,
but coordinate rounding and simplification can still remove very small geometry.

Tile sizes below are compressed bytes, including every nonempty addressed tile.
The median is the arithmetic mean of the two middle values for an even count.
Archive sizes are exact file lengths.

### Published archive

Archive size: 116,018,495 bytes.

| Zoom | Feature records kept | Tiles | Median bytes | Largest bytes |
| --- | ---: | ---: | ---: | ---: |
| 10 | 12,875 | 17 | 5,516 | 143,074 |
| 11 | 43,954 | 51 | 4,144 | 349,358 |
| 12 | 139,027 | 142 | 6,515.5 | 410,553 |
| 13 | 681,820 | 450 | 11,120 | 420,268 |
| 14 | 822,758 | 1,532 | 3,907 | 186,230 |
| 15 | 837,172 | 5,333 | 1,441 | 63,220 |
| 16 | 866,233 | 17,484 | 689 | 20,012 |

### Full properties, default precision

Archive size: 165,719,965 bytes.

| Zoom | Feature records kept | Tiles | Median bytes | Largest bytes |
| --- | ---: | ---: | ---: | ---: |
| 10 | 788,683 | 18 | 141,674 | 7,123,035 |
| 11 | 801,076 | 52 | 31,825 | 4,218,853 |
| 12 | 813,862 | 142 | 27,787.5 | 1,444,191 |
| 13 | 814,163 | 450 | 11,661.5 | 538,304 |
| 14 | 822,758 | 1,532 | 3,907 | 186,230 |
| 15 | 837,172 | 5,333 | 1,441 | 63,220 |
| 16 | 866,233 | 17,484 | 689 | 20,012 |

### Full properties, 14-bit overview

Archive size: 184,201,093 bytes.

| Zoom | Feature records kept | Tiles | Median bytes | Largest bytes |
| --- | ---: | ---: | ---: | ---: |
| 10 | 798,296 | 18 | 176,546.5 | 8,825,975 |
| 11 | 801,917 | 52 | 39,261.5 | 5,270,516 |
| 12 | 814,197 | 142 | 32,009.5 | 1,769,898 |
| 13 | 814,615 | 450 | 13,424.5 | 643,894 |
| 14 | 822,758 | 1,532 | 3,907 | 186,230 |
| 15 | 837,172 | 5,333 | 1,441 | 63,220 |
| 16 | 866,233 | 17,484 | 689 | 20,012 |

### Year only, 14-bit overview

Archive size: 141,398,503 bytes.

| Zoom | Feature records kept | Tiles | Median bytes | Largest bytes |
| --- | ---: | ---: | ---: | ---: |
| 10 | 798,296 | 18 | 82,215 | 3,911,577 |
| 11 | 801,917 | 52 | 18,614.5 | 2,399,368 |
| 12 | 814,197 | 142 | 17,243 | 857,764 |
| 13 | 814,615 | 450 | 7,757 | 326,851 |
| 14 | 822,758 | 1,532 | 3,907 | 186,230 |
| 15 | 837,172 | 5,333 | 1,441 | 63,220 |
| 16 | 866,233 | 17,484 | 689 | 20,012 |

### Implemented build

Archive size: 183,549,114 bytes.

| Zoom | Feature records kept | Tiles | Median bytes | Largest bytes |
| --- | ---: | ---: | ---: | ---: |
| 10 | 798,296 | 18 | 176,546.5 | 8,825,975 |
| 11 | 801,917 | 52 | 39,261.5 | 5,270,516 |
| 12 | 814,197 | 142 | 32,009.5 | 1,769,898 |
| 13 | 814,615 | 450 | 13,424.5 | 643,894 |
| 14 | 823,305 | 1,532 | 3,890.5 | 182,224 |
| 15 | 837,674 | 5,333 | 1,439 | 62,599 |
| 16 | 866,567 | 17,488 | 688 | 19,826 |

## Browser measurements

Headless Google Chrome 156.0.8078.79 used native ANGLE/Metal on an Apple M4 Max.
The viewport was 1440 by 1000 CSS pixels at device scale 1.
The center was longitude -122.676, latitude 45.523.
The app ran through the local Worker on port 8791 with isolated local R2 state.
Chromium used `/tmp/ageofthecity-low-zoom/chrome-profile`.
No Computer Use or Safari was used.

Each row summarizes three fresh browser contexts with the browser cache disabled.
The local Worker cache was reused between runs.
After the initial zoom-13 load, the camera animated linearly to zoom 10 over
five seconds.
Frame samples continued until the map became idle after tile loading.
Initial load and post-animation settle times are medians across three runs.
Frame p95 is the largest run p95; maximum is the largest observed frame interval.
These are `requestAnimationFrame` intervals.
Long gaps between MapLibre `render` events can mean waiting for tile data;
they are recorded separately in the raw results and are not dropped-frame counts.

| Candidate | Initial z13 load, ms | Extra settle at z10, ms | Frame p95, ms | Max frame, ms | Frames over 50 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Published archive | 599 | 283 | 16.7 | 16.8 | 0 |
| Full properties, default precision | 721 | 450 | 16.8 | 16.8 | 0 |
| Full properties, 14-bit overview | 824 | 1155 | 16.8 | 16.8 | 0 |
| Year only, 14-bit overview | 871 | 946 | 16.8 | 50.1 | 1 |
| Implemented build | 819 | 717 | 16.7 | 16.8 | 0 |
| Implemented build with gzip Worker | 666 | 250 | 16.8 | 16.8 | 0 |

The first five rows used the original Worker behavior.
Only the last row used the verified gzip and cache changes.
All reported runs finished without browser errors.
Intermediate gzip runs with invalid cached responses were rejected;
their artifacts in `rejected/` are diagnostic evidence, not valid benchmarks.
The rejected `final-gzip-*` runs predate the Worker restart
and do not measure the new handler.

The original archive showed 15,661 rendered records at zoom 11.9;
the implemented archive showed 223,509 at the same view.
Rendered queries can include pieces from adjacent tiles.
Screenshots show the color and density change directly.
The lean candidate's frame results include its unintended white outlines.

## Screenshots and raw results

All files are under `/tmp/ageofthecity-low-zoom/`.
For each prefix below, screenshots exist at `z10`, `z11`, `z11.9`, `z12`, and `z13`.
For example, `current-z11.9.png` is the published archive and
`final-verified-z11.9.png` is the implemented result with the gzip Worker.

| Prefix | Archive and response path |
| --- | --- |
| `current` | Published archive and original Worker |
| `full-default` | Full properties, default precision, original Worker |
| `full-preserve` | Full properties, 14-bit overview, original Worker |
| `lean-preserve` | Year-only overview, existing highlight style, original Worker |
| `final` | Implemented build, original Worker |
| `final-verified` | Implemented build and verified gzip Worker |

`*-tiles.json` contains per-zoom archive measurements and metadata.
`*-browser.json` contains each frame timing summary and rendered-record count.
`browser/measure.mjs` and `browser/interactions.mjs` contain the temporary
Puppeteer harnesses; Puppeteer was installed only in that temporary directory.
`SHA256SUMS` records the input, published archive, and implemented archive hashes.

The runtime gzip check requested tile 10/163/366 with `Accept-Encoding: gzip`.
Both `verified-first.mvt.gz` and `verified-cached.mvt.gz` matched the stored
archive tile byte for byte with `cmp`, and `gzip -t` accepted the result.
The matching response headers are in `verified-first.headers` and
`verified-cached.headers`.
Unit tests cover gzip and uncompressed bodies, cached reads, HEAD responses,
ETag revalidation, empty tiles, and compressed TileJSON metadata.

The browser interaction check passed at zooms 10, 11, 11.9, 12, 13, 14, 15, and 16.
After each year-filter change, it waited for idle and a 500 ms tile-fade interval.
It limited known years to 1900 and checked every returned record against that range,
then reset the filter and selected a building by clicking the map.
Each popup showed the selected feature's address and construction year.
The share button produced a URL with that building's ID.
The harness captured the clipboard write; it did not test the system clipboard.
Opening the zoom-10 selection's URL selected the same building at zoom 17.
No browser errors occurred.
`final-interactions.json` records the selected buildings and filter counts.

## Reproduction

```bash
bash scripts/build_tiles.sh data/regional-buildings.ndjson data/portland_buildings.pmtiles
pmtiles verify data/portland_buildings.pmtiles
node scripts/inspect_tiles.ts data/portland_buildings.pmtiles > data/tile-metrics.json
python3 scripts/test_build_tiles.py
shellcheck scripts/build_tiles.sh
npm run check
npm test
npm run build
```

The Python tests build real tiles for three small footprints with different years,
including an unknown year.
They check all popup properties and separate records at every zoom from 10 to 16,
and verify that a failed build preserves the previous archive.
The data-refresh workflow runs these tests after installing the tiling tools.
The ordinary site CI does not require system tiling tools.
