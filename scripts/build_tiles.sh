#!/usr/bin/env bash
set -euo pipefail

tippecanoe \
  -o data/portland_buildings.pmtiles \
  -l buildings -n "Portland Building Ages" \
  --projection=EPSG:4326 -Z10 -z16 \
  --drop-densest-as-needed \
  -y year_built -y age_bucket -y bldg_id \
  -y bldg_use -y bldg_sqft -y num_story -y address -y neighborhood \
  -P -f data/buildings_cleaned.ndjson
