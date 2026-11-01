#!/usr/bin/env bash
# Builds data/orientation.pmtiles, the faint water and roads under the buildings,
# from a daily Protomaps basemap build (OpenStreetMap data, ODbL).
#
# Usage: bash scripts/build_orientation.sh [YYYYMMDD]
#
# Without a date, the script uses the newest build listed by Protomaps.
# It crops the build to the bounds in src/data/building-stats.json,
# keeps only the water and roads layers and the properties the map style uses,
# and writes zooms 10 through 14; MapLibre overzooms them above 14.
set -euo pipefail

cd "$(dirname "$0")/.."

for tool in pmtiles tile-join jq curl; do
  if ! command -v "$tool" >/dev/null; then
    echo "error: $tool is not installed; run brew bundle" >&2
    exit 1
  fi
done

build="${1:-}"
if [[ -z "$build" ]]; then
  build="$(curl -fsS https://build-metadata.protomaps.dev/builds.json | jq -r '.[-1].key | rtrimstr(".pmtiles")')"
fi
if [[ ! "$build" =~ ^[0-9]{8}$ ]]; then
  echo "error: expected a build date as YYYYMMDD, got '$build'" >&2
  exit 1
fi

bbox="$(jq -r '.bounds | map(tostring) | join(",")' src/data/building-stats.json)"
work="data/orientation-work"
extract="$work/protomaps-$build.pmtiles"
joined="$work/joined.pmtiles"
output="data/orientation.pmtiles"
mkdir -p "$work"

echo "Extracting Protomaps build $build for $bbox"
pmtiles extract "https://build.protomaps.com/$build.pmtiles" "$extract" \
  --bbox="$bbox" --maxzoom=14

# Roads: highways and named streets; no paths, rail, service roads, or driveways.
# Water: rivers, lakes, sloughs, and canals; no pools or fountains.
filter='{
  "roads": ["all",
    ["in", "kind", "highway", "major_road", "minor_road"],
    ["!in", "kind_detail", "service", "driveway", "parking_aisle", "alley"]],
  "water": ["!in", "kind", "swimming_pool", "fountain", "reef"]
}'

tile-join -q -f -Z10 -z14 \
  -l water -l roads \
  -y kind -y kind_detail -y min_zoom -y sort_rank -y is_bridge -y is_tunnel \
  -j "$filter" \
  -n "Age of the City orientation" \
  -N "Water and roads from Protomaps build $build" \
  -o "$joined" "$extract"

# tile-join records world bounds; a second extract restores the crop bounds.
pmtiles extract -q "$joined" "$output" --bbox="$bbox"
pmtiles verify "$output"
pmtiles show "$output"
