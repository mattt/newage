#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "geopandas",
#   "shapely",
#   "pandas",
#   "pyogrio",
# ]
# ///
from __future__ import annotations

import argparse
from pathlib import Path
from typing import Optional

import geopandas as gpd
from shapely.validation import make_valid


def assign_bucket(year: int) -> str:
    if year == -1:
        return "unknown"
    if year < 1900:
        return "pre-1900"
    if year < 1920:
        return "1900-1919"
    if year < 1945:
        return "1920-1944"
    if year < 1960:
        return "1945-1959"
    if year < 1980:
        return "1960-1979"
    if year < 2000:
        return "1980-1999"
    if year < 2010:
        return "2000-2009"
    return "2010-present"


def normalize_year(value: Optional[float], current_year: int) -> int:
    if value is None:
        return -1
    try:
        year = int(value)
    except (TypeError, ValueError):
        return -1
    if year < 1700 or year > current_year:
        return -1
    return year


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Prepare Portland building footprints for PMTiles."
    )
    parser.add_argument("--input", required=True, help="Path to input dataset")
    parser.add_argument("--output", required=True, help="Output NDJSON path")
    parser.add_argument(
        "--current-year",
        type=int,
        default=2026,
        help="Upper bound for YEAR_BUILT validation",
    )
    parser.add_argument(
        "--simplify",
        type=float,
        default=0.00001,
        help="Simplify tolerance in degrees",
    )
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    gdf = gpd.read_file(input_path)
    gdf = gdf.to_crs("EPSG:4326")

    gdf["year_built"] = gdf["YEAR_BUILT"].apply(
        lambda v: normalize_year(v, args.current_year)
    )
    gdf["age_bucket"] = gdf["year_built"].apply(assign_bucket)

    if args.simplify > 0:
        gdf["geometry"] = gdf["geometry"].simplify(
            tolerance=args.simplify, preserve_topology=True
        )

    gdf["geometry"] = gdf["geometry"].apply(
        lambda geom: (
            make_valid(geom) if geom is not None and not geom.is_valid else geom
        )
    )

    gdf = gdf[["geometry", "year_built", "age_bucket", "BLDG_ID"]]
    gdf = gdf.rename(columns={"BLDG_ID": "bldg_id"})

    gdf.to_file(output_path, driver="GeoJSONSeq")
    print(f"Exported {len(gdf)} buildings to {output_path}")


if __name__ == "__main__":
    main()
