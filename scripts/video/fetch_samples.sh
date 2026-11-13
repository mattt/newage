#!/usr/bin/env bash
# Downloads an instrument from the Versilian Community Sample Library
# (VSCO 2 CE) into data/video/samples/NAME, for render.ts --instrument.
#
# The library's LICENSE is CC0 1.0, which needs no credit; its Readme.txt asks
# for credit to Versilian Studios and a link to the VSCO: CE homepage.
# https://github.com/sgossner/VSCO-2-CE
#
# Usage: bash scripts/video/fetch_samples.sh [harp|marimba]
set -euo pipefail

cd "$(dirname "$0")/../.."

# A fixed commit, so that every render uses the same recordings.
commit="440300901dfe9275fd84e0b7763af1f8443ae62e"
base="https://raw.githubusercontent.com/sgossner/VSCO-2-CE/$commit"
instrument="${1:-harp}"

case "$instrument" in
  harp)
    folder="Strings/Harp"
    # Most notes are recorded mezzo-forte; the extremes, forte or mezzo-piano.
    files=(
      KSHarp_E1_f KSHarp_G1_mp KSHarp_B1_mf KSHarp_D2_mf KSHarp_F2_mf KSHarp_A2_mf
      KSHarp_C3_mf KSHarp_E3_mf KSHarp_G3_mf KSHarp_B3_mf KSHarp_D4_mf KSHarp_F4_mf
      KSHarp_A4_mf KSHarp_C5_mf KSHarp_E5_mf KSHarp_G5_mf KSHarp_B5_mf KSHarp_D6_mf
      KSHarp_F6_mf KSHarp_A6_mf KSHarp_B6_mf KSHarp_D7_f KSHarp_F7_f
    )
    ;;
  marimba)
    folder="Percussion/Marimba"
    files=()
    for note in F1 C2 G2 B2 F3 C4 G4 B4 F5 C6; do
      files+=("Marimba_hit_Outrigger_${note}_loud_01")
    done
    ;;
  *)
    echo "error: unknown instrument '$instrument'; expected harp or marimba" >&2
    exit 1
    ;;
esac

output="data/video/samples/$instrument"
mkdir -p "$output"
curl -fsSL -o "$output/LICENSE" "$base/LICENSE"
curl -fsSL -o "$output/Readme.txt" "$base/Readme.txt"
for file in "${files[@]}"; do
  curl -fsSL -o "$output/$file.wav" "$base/$folder/$file.wav"
done
echo "Wrote ${#files[@]} samples to $output"
