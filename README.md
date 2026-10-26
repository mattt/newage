# New Age of the City

![](./assets/new-age-of-the-city-screenshot.png)

This repo rebuilds the original ["Age of the City"](https://blog.mapbox.com/portland-the-age-of-a-city-19823fd62c60) visualization
by [Justin Palmer](https://github.com/caged)
using [PMTiles](https://github.com/protomaps/PMTiles) hosted on Cloudflare R2/Workers
and rendered with MapLibre GL JS.

## Data source

Portland's Building Footprints dataset includes a `YEAR_BUILT` field suitable for age-based styling.

- Portal: https://gis-pdx.opendata.arcgis.com/datasets/building-footprints
- Metadata: https://www.portlandmaps.com/metadata/index.cfm?action=DisplayLayer&LayerID=52413
- Coordinate system: Oregon State Plane North (NAD 1983);
  must be reprojected to WGS84 (`EPSG:4326`)

Key attributes:

| Field | Type | Description |
|-------|------|-------------|
| `YEAR_BUILT` | Integer | Construction year (nullable) |
| `BLDG_ID` | String | Unique building identifier |
| `BLDG_USE` | String | Use category |
| `BLDG_SQFT` | Integer | Square footage |
| `NUM_STORY` | Integer | Number of stories |

> [!NOTE]
> `YEAR_BUILT` is missing for many features.
> This workflow keeps missing years and labels them as `unknown`.
> Pre-1996 data in Central City came from photogrammetry;
> post-2007 updates come from permits.

## Workflow overview

1. Download the building footprints (Shapefile recommended).
2. Run the preprocessing script to reproject, clean years, and generate NDJSON.
3. Build PMTiles with Tippecanoe.
4. Upload PMTiles to R2 and deploy the Cloudflare Worker,
   which serves the page and the tiles.

## 0) Install dependencies

Install the required tools via Homebrew:

```bash
brew bundle
```

This installs:

- `uv` for Python dependency management
- `tippecanoe` for generating PMTiles
- `pmtiles` CLI for inspecting tilesets

## 1) Python preprocessing

Run the script with `uv`:

```bash
uv run scripts/process_buildings.py \
  --input /path/to/Building_Footprints.shp \
  --output data/buildings_cleaned.ndjson
```

> [!NOTE]
> The script reprojects to WGS84,
> normalizes `YEAR_BUILT`,
> and creates `age_bucket`.
> Missing or invalid years become `-1` and map to `unknown`.
> You can override the current year used for validation:

```bash
uv run scripts/process_buildings.py \
  --input /path/to/Building_Footprints.shp \
  --output data/buildings_cleaned.ndjson \
  --current-year 2026
```

## 2) Build PMTiles with Tippecanoe

Install Tippecanoe (macOS):

```bash
brew install tippecanoe
```

Generate PMTiles:

```bash
tippecanoe \
  -o data/portland_buildings.pmtiles \
  -l buildings \
  -n "Portland Building Ages" \
  --projection=EPSG:4326 \
  -zg \
  --drop-densest-as-needed \
  --extend-zooms-if-still-dropping \
  --coalesce-densest-as-needed \
  -y year_built -y age_bucket -y bldg_id \
  -P \
  -f \
  data/buildings_cleaned.ndjson
```

Sanity check:

```bash
pmtiles show data/portland_buildings.pmtiles
```

## 3) Run the site locally

The `worker/` directory holds the Cloudflare Worker for https://ageofthe.city/.
It serves the page in `frontend/` as static assets
and the tiles from a PMTiles archive in R2, at the same origin:

- `/tiles/portland_buildings.json` returns TileJSON.
  Its tile URLs carry the archive's ETag as `?v=`,
  so a new archive gets new tile URLs.
- `/tiles/portland_buildings/{z}/{x}/{y}.mvt` returns a tile.
  Versioned tiles are cached for a year;
  a position with no buildings returns `204 No Content`.
- `www.ageofthe.city` redirects to `ageofthe.city` with a 308.

The build step (`npm run build`, which Wrangler runs before `dev` and `deploy`)
copies `frontend/` and the MapLibre GL JS files from `node_modules`
into `worker/dist/`.
It requires Node.js 22.18 or later.

Upload the tileset to local R2 and start the development server:

```bash
cd worker
npm install
npx wrangler r2 object put ageofthe-city/portland_buildings.pmtiles \
  --file=../data/portland_buildings.pmtiles --local
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
cd worker
npm install
npx wrangler r2 bucket create ageofthe-city
npx wrangler r2 object put ageofthe-city/portland_buildings.pmtiles \
  --file=../data/portland_buildings.pmtiles --remote
npm run deploy
```

To publish a new tileset, upload it again with the same command.
The TileJSON is cached for five minutes,
then the page requests tiles with the new version.

Check the responses:

```bash
curl -I https://ageofthe.city/
curl -s https://ageofthe.city/tiles/portland_buildings.json
curl -I https://www.ageofthe.city/
```

## Costs

- R2 storage: $0.015/GB/month
- Worker requests: free tier includes 100K requests/day
- A typical 100GB tileset runs around $3-5/month, depending on usage

## License and attribution

The [City of Portland Terms of Use for Open Data](https://www.portlandmaps.com/img/tos.pdf)
make data on the PortlandMaps Open Data website available under the
[Public Domain Dedication and License v1.0](http://www.opendatacommons.org/licenses/pddl/1.0/),
except where the data's page or metadata states otherwise.
The building footprints come from the City of Portland
Bureau of Planning and Sustainability,
and the page credits them.
