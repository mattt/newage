# /// script
# requires-python = ">=3.11"
# dependencies = ["pytest==9.0.2", "geopandas==1.1.1", "shapely==2.1.2", "pyogrio==0.11.1"]
# ///
"""Test pure building data transformations with uv run."""

import math

import pytest
from process_buildings import (
    assign_bucket,
    building_stats,
    format_address,
    normalize_number,
    normalize_year,
)


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


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__]))
