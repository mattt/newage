# /// script
# requires-python = ">=3.11,<3.14"
# dependencies = ["pytest==9.0.2", "geopandas==1.1.1", "shapely==2.1.2", "pyogrio==0.11.1"]
# ///
"""Test pure building data transformations with uv run."""

import json
import math
import sys

import geopandas as gpd
import pytest
from process_buildings import (
    assign_bucket,
    building_stats,
    format_address,
    main,
    normalize_number,
    normalize_year,
    validate_completeness,
)
from shapely.geometry import Point, box


@pytest.mark.parametrize(
    "value", [None, "", "bad", 0, -1, 1699, 2027, 1999.5, math.inf, math.nan]
)
def test_invalid_year(value):
    assert normalize_year(value, 2026) == -1


@pytest.mark.parametrize("value", [1900, 1900.0, "1900", "1900.0"])
def test_year(value):
    assert normalize_year(value, 2026) == 1900


@pytest.mark.parametrize(
    "year,bucket",
    [
        (-1, "unknown"),
        (1899, "pre-1900"),
        (1900, "1900-1919"),
        (1920, "1920-1944"),
        (1945, "1945-1959"),
        (1960, "1960-1979"),
        (1980, "1980-1999"),
        (2000, "2000-2009"),
        (2010, "2010-present"),
    ],
)
def test_bucket(year, bucket):
    assert assign_bucket(year) == bucket


@pytest.mark.parametrize("value", [None, "bad", 0, -100, math.inf, math.nan])
def test_invalid_number(value):
    assert normalize_number(value) == -1


def test_fractional_number():
    assert normalize_number("1.5") == 1.5


def test_address():
    assert format_address({"ADDRESS_FULL": " 123 NW\n Main ST "}) == "123 NW Main ST"
    assert (
        format_address(
            {
                "ADDRESS_NUMBER_CHAR": "0123",
                "STREET_NAME_FULL": "NW MAIN ST",
                "UNIT": "2",
                "UNIT_TYPE": "APT",
            }
        )
        == "0123 NW MAIN ST APT 2"
    )
    assert (
        format_address(
            {
                "ADDRESS_NUMBER_CHAR": "1",
                "STREET_NAME": "MAIN",
                "STREET_TYPE_CODE": "ST",
            }
        )
        == "1 MAIN ST"
    )
    assert format_address({"STREET_NAME_FULL": "MAIN ST"}) == ""
    assert format_address({"ADDRESS_FULL": math.nan}) == ""


def test_stats():
    stats = building_stats([1900, 1901, 1920, -1])
    assert stats["total"] == 4
    assert stats["unknown"] == 1
    assert stats["earliestYear"] == 1900
    assert stats["latestYear"] == 1920
    assert stats["byDecade"] == [
        {"decade": 1900, "count": 2},
        {"decade": 1920, "count": 1},
    ]
    assert building_stats([])["earliestYear"] is None
    assert building_stats([-1])["latestYear"] is None


def test_year_limits():
    assert normalize_year(1700, 2026) == 1700
    assert normalize_year(2026, 2026) == 2026


def test_empty_stats_shape():
    stats = building_stats([])
    assert set(stats) == {
        "source",
        "total",
        "unknown",
        "earliestYear",
        "latestYear",
        "byDecade",
    }
    assert stats["total"] == stats["unknown"] == 0
    assert stats["byDecade"] == []


def test_complete_download():
    validate_completeness("buildings", 100, 100, 100)
    validate_completeness("empty", 0, 0, 0)


@pytest.mark.parametrize(
    "downloaded,unique", [(99, 99), (100, 99), (101, 100), (101, 101)]
)
def test_incomplete_download(downloaded, unique):
    with pytest.raises(
        RuntimeError, match="service count=100.*downloaded features=.*unique OBJECTIDs="
    ):
        validate_completeness("buildings", 100, downloaded, unique)


def test_regional_building_survives_enrichment(tmp_path, monkeypatch):
    # The west footprint is outside both Portland and its neighborhood polygons.
    footprints = [
        box(-123.10, 45.50, -123.099, 45.501),
        box(-122.60, 45.50, -122.599, 45.501),
    ]
    buildings = gpd.GeoDataFrame(
        {
            "OBJECTID": [1, 2],
            "BLDG_ID": ["regional", "city"],
            "YEAR_BUILT": [1980, 1900],
            "BLDG_USE": ["Residential", "Residential"],
            "BLDG_SQFT": [1000, 1200],
            "NUM_STORY": [1, 2],
        },
        geometry=footprints,
        crs=4326,
    )
    neighborhoods = gpd.GeoDataFrame(
        {"OBJECTID": [1], "NAME": ["City neighborhood"]},
        geometry=[box(-122.61, 45.49, -122.59, 45.51)],
        crs=4326,
    )
    addresses = gpd.GeoDataFrame(
        {"OBJECTID": [1], "ADDRESS_FULL": ["1 Regional Road"], "IS_MAIN_ADDRESS": [1]},
        geometry=[Point(-123.0995, 45.5005)],
        crs=4326,
    )
    argv = ["process_buildings.py", "--current-year", "2026"]
    for name, frame in [
        ("buildings", buildings),
        ("addresses", addresses),
        ("neighborhoods", neighborhoods),
    ]:
        path = tmp_path / f"{name}.geojson"
        frame.to_file(path, driver="GeoJSON")
        argv.extend([f"--{name}", str(path)])
    output = tmp_path / "buildings.ndjson"
    stats_path = tmp_path / "stats.json"
    argv.extend(
        [
            "--download-dir",
            str(tmp_path),
            "--output",
            str(output),
            "--stats-output",
            str(stats_path),
        ]
    )
    monkeypatch.setattr(sys, "argv", argv)
    main()
    features = [json.loads(line) for line in output.read_text().splitlines()]
    assert len(features) == 2
    regional = next(
        f["properties"] for f in features if f["properties"]["bldg_id"] == "regional"
    )
    assert regional["address"] == "1 Regional Road"
    assert "neighborhood" not in regional
    city = next(
        f["properties"] for f in features if f["properties"]["bldg_id"] == "city"
    )
    assert city["neighborhood"] == "City neighborhood"
    assert "address" not in city
    stats = json.loads(stats_path.read_text())
    assert stats["total"] == 2
    assert stats["unknown"] == 0
    assert stats["bounds"] == pytest.approx([-123.10, 45.50, -122.599, 45.501])


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__]))
