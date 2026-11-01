# Low-zoom building detail

## Lean overview: shipping stopped at the mobile gate

The current candidate follows the November 1 shipping brief.
Zooms 10 through 12 contain only `year_built` at 14-bit coordinate precision.
Zooms 13 through 16 keep all eight properties at 12-bit precision.
Both ranges disable density dropping and tiny-polygon reduction.
The Worker retains gzip passthrough, including explicit manual encoding
at the Cache API boundaries.
The water and road layers from `main` remain below the buildings.

Below zoom 13, clicking a building or pressing Enter on one zooms to 14
without selecting it or opening a popup.
The pointer cursor, popup, selection, and highlight start at zoom 13.
Zooming below 13 closes an open popup and clears its selection.
An absent or empty building ID cannot match the highlight filter.
Share links naming a building still open at zoom 17.

The archive is **147,309,058 bytes**, compared with 116,018,495 bytes in production
and 183,549,114 bytes for the earlier full-property candidate.
Its largest compressed tile is 3,911,525 bytes.
The new archive's SHA-256 is
`2f1f3d80c61246fee6c1622d15857ed6b267137f2433b7b4df7082bcd03c901f`.
The production comparison archive was downloaded from remote R2 for this test;
its SHA-256 is `b634ef50f72ff9d6c55b3a0ff6206bba4ac02da2b5b5c44e5c4d71df40d4030f`.
The regional input remains the October 30 snapshot of 749,294 footprints.

### Per-zoom archive measurements

Counts are decoded MVT records, including clipped pieces and tile-buffer copies,
not unique input footprints.
Tile sizes are compressed bytes across all nonempty addressed tiles.

| Zoom | Feature records | Tiles | Median bytes | Largest bytes |
| --- | ---: | ---: | ---: | ---: |
| 10 | 798,196 | 18 | 82,634 | 3,911,525 |
| 11 | 801,793 | 52 | 18,671 | 2,398,258 |
| 12 | 814,038 | 142 | 17,248.5 | 856,904 |
| 13 | 814,601 | 450 | 11,682 | 538,576 |
| 14 | 823,305 | 1,532 | 3,890.5 | 182,224 |
| 15 | 837,674 | 5,333 | 1,439 | 62,599 |
| 16 | 866,567 | 17,488 | 688 | 19,826 |

### Mobile comparison

Headless Chrome used a 390 by 844 CSS-pixel viewport at DPR 3,
4x CPU throttling, 150 ms network latency, 1.6 Mbit/s download,
and 750 Kbit/s upload.
The center was longitude -122.676, latitude 45.523.
The local Worker on port 8791 served the merged app, the production orientation
archive, and either the downloaded production buildings or the new buildings.
Only the buildings archive changed between comparisons.
Browser caches were disabled in fresh contexts; the local Worker cache was reused.
The host was an Apple M4 Max with native ANGLE/Metal rendering.
This is Chromium emulation, not a physical phone or a mobile GPU test.

The initial-load interval starts before navigation and ends when both map sources
finish loading.
The zoom interval starts with a five-second zoom animation from 13 to 10
and includes the time needed to load the final tiles.
Its initial zoom-13 preload is excluded from the interval and transferred bytes.
Network totals use CDP encoded transfer lengths, including HTTP headers
and partial response bytes for cancelled intermediate zoom requests.
Heap figures are the peak sampled sum of the main page and MapLibre worker heaps,
sampled every 250 ms.
Long tasks are main-page PerformanceObserver entries longer than 50 ms;
they do not include work inside MapLibre's worker.

| Archive | Scenario | Bytes transferred | Tiles ready, seconds | Peak sampled JS heap, MiB | Long tasks (count / total ms / max ms) | Tab crash |
| --- | --- | ---: | ---: | ---: | --- | --- |
| Production | initial-z10 | 710,858 | 5.25 | 16.1 | 2 / 282 / 155 | No |
| Production | zoom-13-to-10 | 965,528 | 5.53 | 51.0 | 0 / 0 / 0 | No |
| New lean build | initial-z10 | 8,835,740 | 47.11 | 634.1 | 1 / 80 / 80 | No |
| New lean build | zoom-13-to-10 | 9,105,661 | 46.66 | 308.5 | 0 / 0 / 0 | No |

**The new archive fails the requested approximately 20-second loading gate.**
Its initial zoom-10 load took 47.1 seconds; the zoom-out run took 46.7 seconds.
No tab crashed, but the initial run sampled 634.1 MiB of JavaScript heap.
No push, pull request, CI run, squash merge, deployment, or remote R2 upload
was started.
The requested shipping rollback copy was not created because step 8 was not reached.
The production comparison download remains available in the temporary test directory.
The next decision is how to reduce overview geometry or change its representation
while preserving the year filter, before another shipping attempt.

The initial harness tried a separate network override on the dedicated worker target.
Chromium reported that optional command as unsupported.
The page's network throttle stayed active; the measured transfer times reflect
its configured 200,000 bytes per second download limit.
The zoom runs omitted that unsupported call and completed without browser errors.
Cancelled intermediate requests are expected during the camera animation.

### Test artifacts

New artifacts are under `/tmp/ageofthecity-low-zoom/lean-shipping/`.
`new-tiles.json` contains the per-zoom metrics and metadata.
`mobile-production-mobile.json` and `mobile-new-mobile.json` contain the initial loads.
`mobile-production-zoom-mobile.json` and `mobile-new-zoom-mobile.json`
contain zoom runs with partial-transfer accounting.
The earlier zoom entries in `*-mobile.json` omit cancelled-response bytes
and are superseded by those zoom files.

Screenshots are `mobile-production-initial-z10.png`, `mobile-new-initial-z10.png`,
`mobile-production-zoom-13-to-10-accounted.png`,
and `mobile-new-zoom-13-to-10-accounted.png`.
The new archive is `data/lean-buildings.pmtiles` in this worktree.
The production comparison download is `production.pmtiles` in the artifact directory.
The temporary harnesses are `browser/mobile.mjs`, `browser/mobile_zoom.mjs`,
and `browser/lean_interactions.mjs` under `/tmp/ageofthecity-low-zoom/`.

The required type check, 116 unit tests, site build, and three tile regression tests
passed.
The tile tests decode actual tiles and require only the construction year below
zoom 13, with separate years and full popup properties from zoom 13 onward.
The highlight tests use MapLibre's filter evaluator for missing, empty,
null, selected, and year-filtered IDs.
The headless interaction check passed at zooms 10, 11, 11.9, 12, 13, 14, 15, and 16.
Click and Enter zoomed to 14 below the selection boundary, without a popup,
pointer cursor, or highlight.
The year filter worked at every tested zoom, and detail popups showed the selected
building's address and year from zoom 13 onward.
A generated share link selected the same building at zoom 17.
`lean-interactions.json` records those checks; its clipboard write was captured
by the harness rather than sent to the system clipboard.

## Earlier full-property study

The following sections preserve the earlier desktop comparison.
Their full-property recommendation was superseded by the lean candidate above.
Those desktop results do not override the failed mobile gate.

Measured on November 1, 2026, using the published October 30 regional input:
749,294 footprints, Tippecanoe 2.79.0, and the repository's MapLibre 6.16.0.
The original input and archive were symlinked into the worktree for reading.
All candidate outputs were written to separate files.

## Earlier recommendation

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
