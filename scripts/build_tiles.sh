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

# Keep each footprint's own year and popup properties at every zoom.
# Fail above 10 MB per compressed tile instead of silently dropping buildings.
common=(
  -l buildings -n "Portland Building Ages"
  --projection=EPSG:4326
  --no-tiny-polygon-reduction --no-feature-limit
  --maximum-tile-bytes=10000000
  --no-progress-indicator
  -y year_built -y age_bucket -y bldg_id
  -y bldg_use -y bldg_sqft -y num_story -y address -y neighborhood
  -P
)

# Extra coordinate precision keeps small buildings from collapsing at city scale.
# Fix minimum detail too, so the tile-size limit cannot reduce that precision.
tippecanoe "${common[@]}" -Z10 -z13 \
  --full-detail=14 --low-detail=14 --minimum-detail=14 \
  -o "$work_dir/overview.pmtiles" "$input"
tippecanoe "${common[@]}" -Z14 -z16 \
  --full-detail=12 --low-detail=12 --minimum-detail=12 \
  -o "$work_dir/detail.pmtiles" "$input"

# tile-join otherwise skips tiles larger than its default 500 KB limit.
tile-join --no-tile-size-limit -o "$work_dir/buildings.pmtiles" \
  "$work_dir/overview.pmtiles" "$work_dir/detail.pmtiles"
mv -f "$work_dir/buildings.pmtiles" "$output"
