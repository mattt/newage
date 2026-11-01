#!/usr/bin/env bash
set -euo pipefail

input=${1:-data/buildings_cleaned.ndjson}
output=${2:-data/portland_buildings.pmtiles}
if [[ -L "$output" ]]; then
  echo "Refusing to replace a symlink: $output" >&2
  exit 1
fi
output_dir=$(dirname "$output")
mkdir -p "$output_dir"
work_dir=$(mktemp -d "$output_dir/.build-tiles.XXXXXX")
trap 'rm -rf "$work_dir"' EXIT

# Keep each footprint's own year; add popup properties at selection zooms.
# Fail above 10 MB per compressed tile instead of silently dropping buildings.
common=(
  -l buildings -n "Portland Building Ages"
  --projection=EPSG:4326
  --no-feature-limit
  --maximum-tile-bytes=10000000
  --no-progress-indicator
  -P
)

# Approximate sub-pixel footprints with area-weighted squares. Coalesce only
# identical years, so the filter and Play retain a separate value for each year.
# Grouping geometry avoids a separate feature object for every tiny footprint.
tippecanoe "${common[@]}" -Z10 -z12 -y year_built \
  --full-detail=11 --low-detail=11 --minimum-detail=11 \
  --coalesce --reorder \
  -o "$work_dir/overview.pmtiles" "$input"
tippecanoe "${common[@]}" -Z13 -z16 \
  --no-tiny-polygon-reduction \
  --full-detail=12 --low-detail=12 --minimum-detail=12 \
  -y year_built -y age_bucket -y bldg_id \
  -y bldg_use -y bldg_sqft -y num_story -y address -y neighborhood \
  -o "$work_dir/detail.pmtiles" "$input"

# tile-join otherwise skips tiles larger than its default 500 KB limit.
tile-join --no-tile-size-limit -n "Portland Building Ages" -o "$work_dir/buildings.pmtiles" \
  "$work_dir/overview.pmtiles" "$work_dir/detail.pmtiles"
mv -f "$work_dir/buildings.pmtiles" "$output"
