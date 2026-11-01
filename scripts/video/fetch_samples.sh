#!/usr/bin/env bash
# Downloads the harp from the Versilian Community Sample Library (VSCO 2 CE)
# into data/video/samples/harp, for render.ts --instrument harp.
#
# The library's LICENSE is CC0 1.0, which needs no credit; its Readme.txt asks
# for credit to Versilian Studios and a link to the VSCO: CE homepage.
# https://github.com/sgossner/VSCO-2-CE
#
# Usage: bash scripts/video/fetch_samples.sh
set -euo pipefail

cd "$(dirname "$0")/../.."

# A fixed commit, so that every render uses the same recordings.
commit="440300901dfe9275fd84e0b7763af1f8443ae62e"
base="https://raw.githubusercontent.com/sgossner/VSCO-2-CE/$commit"
output="data/video/samples/harp"

notes=(E1 G1 B1 D2 F2 A2 C3 E3 G3 B3 D4 F4 A4 C5 E5 G5 B5 D6 F6 A6 B6 D7 F7)
mkdir -p "$output"
curl -fsSL -o "$output/LICENSE" "$base/LICENSE"
curl -fsSL -o "$output/Readme.txt" "$base/Readme.txt"
for note in "${notes[@]}"; do
  # Most notes are recorded mezzo-forte; the extremes, forte or mezzo-piano.
  for dynamic in mf f mp; do
    file="KSHarp_${note}_${dynamic}.wav"
    if curl -fsSL -o "$output/$file" "$base/Strings/Harp/$file" 2>/dev/null; then
      break
    fi
    rm -f "$output/$file"
  done
  if ! ls "$output"/KSHarp_"${note}"_*.wav >/dev/null 2>&1; then
    echo "error: no sample for $note" >&2
    exit 1
  fi
done
echo "Wrote ${#notes[@]} samples to $output"
