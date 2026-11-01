# Age of the City

![](./public/og-image.jpg)

This repo rebuilds the 2013 map ["Portland, Oregon: The Age of a City"](https://labratrevenge.com/)
by [Justin Palmer](https://github.com/caged)
using [PMTiles](https://github.com/protomaps/PMTiles) hosted on Cloudflare R2/Workers
and rendered with MapLibre GL JS.

## Data sources

The City of Portland [Open Data portal](https://gis-pdx.opendata.arcgis.com/)
provides these ArcGIS layers:

| Dataset | Exact service URL | Fields used |
| --- | --- | --- |
| Building Footprints | https://www.portlandmaps.com/od/rest/services/COP_OpenData_Property/MapServer/48 | `BLDG_ID`, `YEAR_BUILT`, `BLDG_USE`, `BLDG_SQFT`, `NUM_STORY` |
| Active Address Points | https://www.portlandmaps.com/od/rest/services/COP_OpenData_Property/MapServer/1272 | `ADDRESS_FULL`, address components, `IS_MAIN_ADDRESS`, `OBJECTID` |
| Neighborhood Boundaries | https://www.portlandmaps.com/od/rest/services/COP_OpenData_Boundary/MapServer/3 | `NAME` |

## Setup

Run `brew bundle` for `uv`, `tippecanoe`, and the `pmtiles` CLI,
and `npm ci` for site dependencies.
Python scripts declare dependencies with PEP 723 metadata and accept Python 3.11–3.13.
GIS workflows use 3.12; Python 3.14 lacks a wheel for pinned `pyogrio` 0.11.1.
Inputs and tiles stay in the ignored `data/` directory.

## 1) Download and process buildings

```bash
uv run scripts/process_buildings.py
```

This writes `data/inputs/{buildings,neighborhoods,addresses}.geojson`,
`data/buildings_cleaned.ndjson`, and `src/data/building-stats.json`.
Each run downloads fresh inputs unless overridden locally.
The script reads live pagination metadata and downloads all layers with `where=1=1`,
no spatial filter, and `orderByFields=OBJECTID` (or the declared object ID field).
It retries failed requests and rejects incomplete pages and duplicate IDs.
Before replacing an input, it checks feature and unique ID counts against
`returnCountOnly` queries before and after download, and prints all counts.
ArcGIS has no transaction across layers; retain inputs to reproduce a snapshot.
The complete regional footprint layer includes neighboring cities.
Address and neighborhood joins retain unmatched buildings.

Reuse all three saved inputs without network requests:

```bash
uv run scripts/process_buildings.py \
  --buildings data/inputs/buildings.geojson \
  --addresses data/inputs/addresses.geojson \
  --neighborhoods data/inputs/neighborhoods.geojson \
  --current-year 2026 \
  --output data/buildings_cleaned.ndjson \
  --stats-output src/data/building-stats.json
```

Overrides accept any GeoPandas-readable dataset with matching fields and a declared CRS.
`--input` is an alias for `--buildings`.
`--download-dir` changes the download directory.
The validation year defaults to the current calendar year.

Geometry repair and spatial joins use UTM zone 10N (`EPSG:32610`), in metres.
The script drops empty geometries, non-polygon footprints and boundaries,
and non-point addresses after repair.
It reports losses, WGS84 bounds, and join coverage, without simplifying footprints.

Neighborhoods contain footprint centroids; alphabetical order breaks overlap ties.
The address comes from a point covered by the footprint, including its boundary.
If none is available, the nearest point within 30 metres of the footprint is used.
Main addresses, then lowest object IDs, break containment or equal-distance ties.
Points without usable addresses are excluded.
Addresses use `ADDRESS_FULL`, including units,
or fall back to number, street name, and unit fields.
Nearest addresses can belong to another building.

| Tile property | Convention |
| --- | --- |
| `year_built` | Integer from 1700 through the validation year; otherwise `-1`. Fractional years are invalid. |
| `age_bucket` | Existing age bands from `pre-1900` through `2010-present`; `unknown` for year `-1`. |
| `bldg_id` | Source building ID as a string; empty string if absent. |
| `bldg_use` | Source use as a string; empty string if absent. |
| `bldg_sqft`, `num_story` | Positive finite numbers; missing, zero, negative, and invalid values become `-1`. Fractions are retained. |
| `address`, `neighborhood` | Strings; omitted when unknown. |

Statistics describe retained footprints before tiling.
The JSON contains `source`, `total`, `unknown`, `earliestYear`, `latestYear`, and `byDecade`,
and records `bounds` as `[west, south, east, north]` in WGS84.
The map pan limits, OG card validation, and Dataset metadata use these bounds.
Buildings outside Portland neighborhoods have no neighborhood value.
Year limits are `null` when no known years remain.
Counts are not deduplicated by `BLDG_ID`: these labels can repeat,
and selecting one can highlight multiple footprints.

Run the focused Python tests:

```bash
uv run scripts/test_process_buildings.py
```

## 2) Build and verify PMTiles

```bash
bash scripts/build_tiles.sh
pmtiles show data/portland_buildings.pmtiles
pmtiles verify data/portland_buildings.pmtiles
```

Zooms 10 through 12 keep only `year_built`, with 11-bit coordinates.
Tippecanoe approximates tiny footprints with area-weighted squares
and groups geometry with the same year to reduce browser memory use.
Zooms 13 through 16 keep all popup properties, with 12-bit coordinates.
Both ranges disable density dropping;
detail zooms also disable tiny-polygon reduction.
A fixed 10 MB compressed tile limit fails the build instead of reducing precision.
`tile-join` combines the ranges into one `buildings` layer.
The Worker preserves gzip compression through its tile cache.

Below zoom 13, clicking a building or pressing Enter on one zooms in to inspect it.
Selection, hover, popups, and the highlight start at zoom 13.
Building share links still open at zoom 17.

The script accepts input and output paths as optional arguments.
To inspect tile sizes and run the tiling tests:

```bash
node scripts/inspect_tiles.ts data/portland_buildings.pmtiles
python3 scripts/test_build_tiles.py
```

See the [low-zoom measurements](docs/low-zoom-detail.md) for archive sizes,
feature-record counts, and the throttled mobile comparison.
The reduced overview meets the mobile load and heap targets in Chromium emulation.
It is not published.

The [refresh workflow](.github/workflows/refresh-buildings.yml) runs manually
with `workflow_dispatch` and from the default branch monthly on day 1 at 10:17 UTC.
It uses macOS and `brew bundle` to test transformations, rebuild data and statistics,
and build and verify the archive.
Artifacts retain PMTiles, statistics JSON, `pmtiles show` output, and SHA-256 hashes
for 30 days.
The workflow has no Cloudflare credentials and never publishes.

Before publication, download the artifact, inspect metadata, and verify hashes.
Update `src/data/building-stats.json` through a pull request.
R2 upload requires separate approval; coordinate it with deployment of matching statistics.
Keep the previous archive for rollback.

## Orientation layers

Water and roads use `data/orientation.pmtiles`, cropped from a daily
[Protomaps basemap build](https://docs.protomaps.com/basemaps/downloads)
of OpenStreetMap data.
Rebuild it manually; the monthly workflow excludes it:

```bash
bash scripts/build_orientation.sh            # newest build
bash scripts/build_orientation.sh 20261101   # a specific build, for a repeatable archive
```

The script extracts zooms 0 through 14 for the bounds in `src/data/building-stats.json`,
then uses `tile-join` to keep zooms 10 through 14,
the `water` and `roads` layers, and the properties the style reads.
Roads keep highways, major roads, and residential streets,
without paths, rail, service roads, or driveways.
Water keeps rivers, lakes, sloughs, and canals, without pools and fountains.
The archive is about 9 MB; MapLibre overzooms it above zoom 14.

The Worker serves archives by name, including `/tiles/orientation.json`.
Upload locally for development or remotely for deployment:

```bash
npx wrangler r2 object put ageofthe-city/orientation.pmtiles \
  --file=data/orientation.pmtiles --local
npx wrangler r2 object put ageofthe-city/orientation.pmtiles \
  --file=data/orientation.pmtiles --remote
```

Upload the archive to the remote bucket before you deploy
the first version of the site that reads `orientation.pmtiles`.

The style in `src/lib/orientation.ts` adds shorelines at zoom 12
and fades residential streets in from zoom 13.5 to 15.
Water and roads have no labels and are darker than unknown-age buildings.

## 3) Run the site locally

Astro pages live in `src/`; the Cloudflare Worker lives in `worker/`.
The Worker serves `dist/` assets and R2 tiles at the same origin:

- `/tiles/portland_buildings.json` returns TileJSON.
  Its tile URLs carry the archive's ETag as `?v=`,
  so a new archive gets new tile URLs.
- `/tiles/portland_buildings/{z}/{x}/{y}.mvt` returns a tile.
  Versioned tiles are cached for a year;
  a position with no buildings returns `204 No Content`.
- `www.ageofthe.city` redirects to `ageofthe.city` with a 308.

Wrangler runs `npm run build` before `dev` and `deploy` to build `dist/`
and check internal links for trailing slashes.
Node.js 22.23.4 or later is required.
`npm run check` type-checks the site and the Worker,
and `npm test` runs their unit tests.

Upload the tileset to local R2 and start the development server:

```bash
npx wrangler r2 object put ageofthe-city/portland_buildings.pmtiles \
  --file=data/portland_buildings.pmtiles --local
npm run dev
```

Open http://localhost:8787/.

## 4) Deploy to Cloudflare

The Worker `ageofthe-city` serves the custom domains
`ageofthe.city` and `www.ageofthe.city`,
and reads the tiles from the R2 bucket `ageofthe-city`.
The zone for `ageofthe.city` must be in the same Cloudflare account.
If your Wrangler login has access to more than one account,
set `CLOUDFLARE_ACCOUNT_ID` first.

```bash
npx wrangler r2 bucket create ageofthe-city
npx wrangler r2 object put ageofthe-city/portland_buildings.pmtiles \
  --file=data/portland_buildings.pmtiles --remote
npm run deploy
```

For the lean overview, deploy the zoom-gated selection code before uploading tiles.
Older code highlights low-zoom features that have no building ID.
Save the current archive for rollback before replacing it.
The TileJSON is cached for five minutes,
then the page requests tiles with the new version.

Check the responses:

```bash
curl -I https://ageofthe.city/
curl -s https://ageofthe.city/tiles/portland_buildings.json
curl -I https://www.ageofthe.city/
```

## Launch video

`scripts/video/` renders a time lapse of the places in `scripts/video/places.json`,
each one a center and zoom where the buildings appear year by year, as in Play.
It reads `data/regional-buildings.ndjson`, `data/regional-buildings.pmtiles`,
and `data/orientation.pmtiles`, and needs ffmpeg and Playwright's Chromium:

```bash
npx playwright-core install chromium-headless-shell
npm run video:survey                 # buildings, years, and timing for each place
npm run video:render -- --stills     # each place at the last year, and a contact sheet
npm run video:render -- --only ladds-addition --size 1080x1920 --size 1920x1080
npm run video:render -- --size 1920x1080 --years-per-second 20 --hold 1.5 --fade 0.3
```

The first run caches building centroids in `data/video/buildings.bin`.
Output goes to the ignored `renders/` directory:
one MP4 for each place and, for more than one place, `sequence.mp4`.
Run `node scripts/video/render.ts --help` for every option.

For each frame, a page with the site's style and year filter sets the latest year,
waits for the map to finish drawing, and headless Chromium captures it.
The short side of every frame is 540 CSS pixels,
so a place's zoom shows the same width of ground in either orientation.
A clip starts in the decade before its earliest buildings
unless the place sets `start`.

The soundtrack comes from the same buildings:
each one in the frame plucks a synthesized string on the frame where its year arrives.
Larger buildings play lower notes on a D major pentatonic scale,
newer buildings sound brighter,
and a building's position across the frame sets its pan.
Busy years play louder, up to 45 notes a second.
The mix is normalized to -16 LUFS integrated, with a limiter at about -2 dBFS.
Beside each MP4, the renderer writes the soundtrack as a 24-bit WAV,
a type 1 MIDI file with a marker and a track for each place,
and the notes as JSON and CSV, with each note's time, place, year, pitch, velocity, and pan.

`--instrument` plays the same notes on another instrument:
`analog`, two detuned saws through a resonant low-pass, with chorus and tape delay;
`bells`, a two-operator FM bell;
`analog-pad`, `analog` over a quiet pad that changes chord with each place;
and `harp` or `marimba`, recordings from the
[Versilian Community Sample Library](https://github.com/sgossner/VSCO-2-CE)
(VSCO 2 CE), whose license is CC0 1.0;
its readme asks for credit to Versilian Studios.
`bash scripts/video/fetch_samples.sh harp` (or `marimba`) downloads the samples
to `data/video/samples/`,
and `--reuse-frames` keeps earlier frames so that only the sound changes:

```bash
npm run video:render -- --size 1920x1080 --reuse-frames --instrument harp
```

### Whole-city shot

`scripts/video/region.json` frames the whole region.
A place's `frames` gives a center and zoom for each output size,
because a wide and a tall frame hold the city differently.
`node scripts/video/fit.ts --share 0.93` finds, for each size,
the tightest frame that holds that share of all building centroids.

At this scale most buildings are smaller than a pixel,
and the zooms fall below the archive's lowest zoom, 10.
`--supersample 4` draws the map at four times the output size, four times closer,
so that it loads finer tiles, and scales each frame down with a Lanczos filter.
Thousands of buildings arrive each year, so `--busiest auto` scales the notes
to the busiest year in view, instead of playing every year at the note cap:

```bash
npm run video:render -- --places scripts/video/region.json \
  --size 1920x1080 --size 1080x1920 --years-per-second 6 --hold 4 \
  --supersample 4 --busiest auto --instrument harp \
  --buildings-tiles data/production-buildings.pmtiles
```

This shot uses the production archive, which keeps nearly every building
at zooms 10 to 12.

## Costs

The production buildings archive is about 116 MB; the reduced overview archive is 121 MB.
Orientation adds 8.7 MB.
[R2 Standard](https://developers.cloudflare.com/r2/pricing/) includes free monthly allowances
of 10 GB-month, 1 million Class A operations, and 10 million Class B operations.
Overages cost $0.015/GB-month, $4.50/million A, and $0.36/million B.
R2 has no egress fees.
[Workers Free](https://developers.cloudflare.com/workers/platform/pricing/) allows 100,000 requests/day.

## License and attribution

The [City of Portland Terms of Use for Open Data](https://www.portlandmaps.com/img/tos.pdf)
make data on the PortlandMaps Open Data website available under the
[Public Domain Dedication and License v1.0](http://www.opendatacommons.org/licenses/pddl/1.0/),
except where the data's page or metadata states otherwise.
The building footprints come from the City of Portland
Bureau of Planning and Sustainability,
and the page credits them.

The water and street lines come from OpenStreetMap
through a [Protomaps basemap build](https://docs.protomaps.com/basemaps/downloads).
OpenStreetMap data is available under the
[Open Database License](https://www.openstreetmap.org/copyright),
and the page credits OpenStreetMap contributors.
