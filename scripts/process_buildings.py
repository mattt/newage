#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11,<3.14"
# dependencies = ["geopandas==1.1.1", "shapely==2.1.2", "pyogrio==0.11.1"]
# ///
"""Download Portland GIS inputs and prepare building GeoJSON sequences."""

from __future__ import annotations

import argparse
import json
import math
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

import geopandas as gpd
from shapely import make_valid

BASE = "https://www.portlandmaps.com/od/rest/services/"
SOURCES = {
    "buildings": BASE + "COP_OpenData_Property/MapServer/48",
    "addresses": BASE + "COP_OpenData_Property/MapServer/1272",
    "neighborhoods": BASE + "COP_OpenData_Boundary/MapServer/3",
}
FIELDS = {
    "buildings": "OBJECTID,BLDG_ID,YEAR_BUILT,BLDG_USE,BLDG_SQFT,NUM_STORY",
    "addresses": "OBJECTID,ADDRESS_FULL,ADDRESS_NUMBER_CHAR,STREET_NAME_FULL,STREET_PREFIX_DIRECTION,STREET_NAME,STREET_TYPE_CODE,STREET_POST_DIRECTION,UNIT,UNIT_TYPE,IS_MAIN_ADDRESS",
    "neighborhoods": "OBJECTID,NAME",
}


def normalize_number(value) -> float:
    try:
        number = float(value)
        return number if math.isfinite(number) and number > 0 else -1
    except (TypeError, ValueError, OverflowError):
        return -1


def normalize_year(value, current_year: int) -> int:
    number = normalize_number(value)
    return (
        int(number)
        if float(number).is_integer() and 1700 <= number <= current_year
        else -1
    )


def assign_bucket(year: int) -> str:
    if year == -1:
        return "unknown"
    for upper, label in [
        (1900, "pre-1900"),
        (1920, "1900-1919"),
        (1945, "1920-1944"),
        (1960, "1945-1959"),
        (1980, "1960-1979"),
        (2000, "1980-1999"),
        (2010, "2000-2009"),
    ]:
        if year < upper:
            return label
    return "2010-present"


def clean_text(value) -> str:
    return " ".join(value.split()) if isinstance(value, str) else ""


def format_address(row) -> str:
    full = clean_text(row.get("ADDRESS_FULL"))
    if full:
        return full
    number = clean_text(row.get("ADDRESS_NUMBER_CHAR"))
    street = clean_text(row.get("STREET_NAME_FULL")) or " ".join(
        filter(
            None,
            (
                clean_text(row.get(key))
                for key in [
                    "STREET_PREFIX_DIRECTION",
                    "STREET_NAME",
                    "STREET_TYPE_CODE",
                    "STREET_POST_DIRECTION",
                ]
            ),
        )
    )
    if not number or not street:
        return ""
    unit = clean_text(row.get("UNIT"))
    return " ".join(
        filter(
            None,
            [number, street, clean_text(row.get("UNIT_TYPE")) if unit else "", unit],
        )
    )


def building_stats(years) -> dict:
    years = list(years)
    known = [year for year in years if year != -1]
    decades = Counter(year // 10 * 10 for year in known)
    return {
        "source": "City of Portland Building Footprints, via scripts/process_buildings.py",
        "total": len(years),
        "unknown": len(years) - len(known),
        "earliestYear": min(known, default=None),
        "latestYear": max(known, default=None),
        "byDecade": [
            {"decade": decade, "count": count}
            for decade, count in sorted(decades.items())
        ],
    }


def request_json(url, params):
    for attempt in range(5):
        try:
            with urlopen(url + "?" + urlencode(params), timeout=120) as response:
                result = json.load(response)
            if "error" in result:
                raise RuntimeError(result["error"])
            return result
        except Exception:
            if attempt == 4:
                raise
            time.sleep(2**attempt)


def validate_completeness(name, expected, downloaded, unique):
    if downloaded != expected or unique != expected:
        raise RuntimeError(
            f"Incomplete {name} download: service count={expected}, "
            f"downloaded features={downloaded}, unique OBJECTIDs={unique}. "
            "The source may have changed during pagination; rerun the download."
        )


def download(name, directory):
    url = SOURCES[name]
    metadata = request_json(url, {"f": "json"})
    if not metadata.get("advancedQueryCapabilities", {}).get("supportsPagination"):
        raise RuntimeError(f"{url} no longer supports pagination")
    oid = next(
        field["name"]
        for field in metadata["fields"]
        if field["type"] == "esriFieldTypeOID"
    )
    params = {"where": "1=1"}
    count = request_json(
        url + "/query", dict(params, f="json", returnCountOnly="true")
    )["count"]
    print(f"Fetching {name}: {count} candidate features", flush=True)
    page_size = min(metadata["maxRecordCount"], 2000)

    def page(offset):
        data = request_json(
            url + "/query",
            dict(
                params,
                f="geojson",
                outFields=FIELDS[name],
                outSR=4326,
                orderByFields=oid,
                resultOffset=offset,
                resultRecordCount=page_size,
            ),
        )
        features = data["features"]
        if len(features) != min(page_size, count - offset):
            raise RuntimeError(f"Incomplete {name} page at {offset}; retry the rebuild")
        return features

    path = directory / f"{name}.geojson"
    temporary = path.with_suffix(".tmp")
    seen = set()
    downloaded = 0
    with temporary.open("w") as output, ThreadPoolExecutor(max_workers=4) as pool:
        output.write('{"type":"FeatureCollection","features":[')
        first = True
        for features in pool.map(page, range(0, count, page_size)):
            for feature in features:
                downloaded += 1
                identity = feature["properties"][oid]
                if identity in seen:
                    raise RuntimeError(
                        f"Duplicate {name} ID {identity}; source changed during download"
                    )
                seen.add(identity)
                if not first:
                    output.write(",")
                json.dump(feature, output, separators=(",", ":"), allow_nan=False)
                first = False
            if len(seen) % 10000 < page_size:
                print(f"Downloaded {name}: {len(seen)}/{count}", flush=True)
        output.write("]}")
    validate_completeness(name, count, downloaded, len(seen))
    final_count = request_json(
        url + "/query", dict(params, f="json", returnCountOnly="true")
    )["count"]
    validate_completeness(name, final_count, downloaded, len(seen))
    print(
        f"{name} completeness: service before={count}; service after={final_count}; "
        f"downloaded={downloaded}; unique OBJECTIDs={len(seen)}",
        flush=True,
    )
    temporary.replace(path)
    print(f"Downloaded {name}: {count} features from {url}", flush=True)
    return path


def load(path, name, polygon=True):
    frame = gpd.read_file(path).to_crs(32610)
    before = len(frame)
    frame = frame[frame.geometry.notna() & ~frame.geometry.is_empty].copy()
    invalid = int((~frame.geometry.is_valid).sum())
    frame.geometry = frame.geometry.map(make_valid)
    types = ["Polygon", "MultiPolygon"] if polygon else ["Point"]
    frame = frame[frame.geom_type.isin(types)].reset_index(drop=True)
    print(
        f"{name}: {before} input; repaired {invalid}; dropped {before - len(frame)} empty/non-{'polygon' if polygon else 'point'} geometries",
        flush=True,
    )
    return frame


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in SOURCES:
        parser.add_argument(
            f"--{name}", type=Path, help=f"Local {name} dataset instead of downloading"
        )
    parser.add_argument(
        "--input", dest="buildings", type=Path, help="Alias for --buildings"
    )
    parser.add_argument("--download-dir", type=Path, default=Path("data/inputs"))
    parser.add_argument(
        "--output", type=Path, default=Path("data/buildings_cleaned.ndjson")
    )
    parser.add_argument(
        "--stats-output", type=Path, default=Path("src/data/building-stats.json")
    )
    parser.add_argument("--current-year", type=int, default=date.today().year)
    args = parser.parse_args()
    args.download_dir.mkdir(parents=True, exist_ok=True)
    buildings = load(
        args.buildings or download("buildings", args.download_dir), "buildings"
    )
    # Keep the complete regional layer. Enrichment must not restrict its extent.
    neighborhoods = load(
        args.neighborhoods or download("neighborhoods", args.download_dir),
        "neighborhoods",
    )
    addresses = load(
        args.addresses or download("addresses", args.download_dir),
        "addresses",
        polygon=False,
    )
    neighborhoods["NAME"] = neighborhoods.NAME.map(clean_text)
    neighborhoods = neighborhoods[neighborhoods.NAME != ""].copy()
    addresses["address"] = addresses.apply(format_address, axis=1)
    before = len(addresses)
    addresses = addresses[addresses.address != ""].copy()
    print(
        f"Address formatting: dropped {before - len(addresses)} unusable points",
        flush=True,
    )
    # Prefer main addresses, then stable source IDs, when several points qualify.
    addresses = addresses.sort_values(
        ["IS_MAIN_ADDRESS", "OBJECTID"], ascending=[False, True], kind="stable"
    ).reset_index(drop=True)
    centers = gpd.GeoDataFrame(geometry=buildings.geometry.centroid, crs=buildings.crs)
    joined = gpd.sjoin(centers, neighborhoods[["NAME", "geometry"]], predicate="within")
    neighborhood = joined.sort_values("NAME").groupby(level=0).NAME.first()
    print(
        f"Neighborhood join: {len(neighborhood)} matches; no buildings dropped",
        flush=True,
    )
    inside = gpd.sjoin(
        buildings[["geometry"]], addresses[["address", "geometry"]], predicate="covers"
    )
    inside = inside.sort_values("index_right").groupby(level=0).address.first()
    remaining = buildings.loc[~buildings.index.isin(inside.index), ["geometry"]]
    nearest = gpd.sjoin_nearest(
        remaining,
        addresses[["address", "geometry"]],
        max_distance=30,
        distance_col="distance",
    )
    nearest = (
        nearest.sort_values(["distance", "index_right"])
        .groupby(level=0)
        .address.first()
    )
    print(
        f"Address join: {len(inside)} inside; {len(nearest)} nearest within 30 m; no buildings dropped",
        flush=True,
    )
    buildings["address"] = inside.combine_first(nearest).reindex(buildings.index)
    buildings["neighborhood"] = neighborhood.reindex(buildings.index)
    buildings["year_built"] = buildings.YEAR_BUILT.map(
        lambda value: normalize_year(value, args.current_year)
    )
    buildings["age_bucket"] = buildings.year_built.map(assign_bucket)
    buildings["bldg_id"] = buildings.BLDG_ID.map(clean_text)
    buildings["bldg_use"] = buildings.BLDG_USE.map(clean_text)
    for field in ["bldg_sqft", "num_story"]:
        buildings[field] = buildings[field.upper()].map(normalize_number)
    fields = [
        "year_built",
        "age_bucket",
        "bldg_id",
        "bldg_use",
        "bldg_sqft",
        "num_story",
        "address",
        "neighborhood",
        "geometry",
    ]
    output = buildings[fields].to_crs(4326)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w") as stream:
        for feature in output.iterfeatures(na="drop", drop_id=True):
            stream.write(
                json.dumps(feature, separators=(",", ":"), allow_nan=False) + "\n"
            )
    stats = building_stats(buildings.year_built)
    stats["bounds"] = output.total_bounds.tolist()
    args.stats_output.parent.mkdir(parents=True, exist_ok=True)
    args.stats_output.write_text(json.dumps(stats, indent=2) + "\n")
    print(
        f"Final: {len(output)} buildings; bounds {output.total_bounds.tolist()}; unknown years {stats['unknown']}"
    )
    for field in ["address", "neighborhood"]:
        print(
            f"{field}: {output[field].notna().sum()} ({output[field].notna().mean():.2%})"
        )


if __name__ == "__main__":
    main()
