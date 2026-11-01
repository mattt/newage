"""Check overview area and years, detail properties, and safe archive replacement."""

import json
import math
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parent.parent


def contains(ring, point):
    x, y = point
    inside = False
    for a, b in zip(ring, ring[1:]):
        if ((a[1] > y) != (b[1] > y)
                and x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]):
            inside = not inside
    return inside


def covers(geometry, point):
    polygons = (geometry["coordinates"] if geometry["type"] == "MultiPolygon"
                else [geometry["coordinates"]])
    return any(contains(polygon[0], point)
               and not any(contains(hole, point) for hole in polygon[1:]) for polygon in polygons)


class BuildTilesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        for command in ("tippecanoe", "tile-join", "tippecanoe-decode", "pmtiles"):
            if shutil.which(command) is None:
                raise RuntimeError(f"Install {command} before running tile tests (brew bundle)")

    def test_grouping_keeps_each_year_and_detail_properties(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            source = directory / "buildings.ndjson"
            archive = directory / "buildings.pmtiles"
            expected = {}
            features = []
            # Full-pixel footprints let us check that grouping preserves each
            # year's geometry, including two distinct buildings with the same year.
            for index, year in enumerate((1890, 1890, 2020, -1)):
                lng, lat = -122.6784 + index * 0.001, 45.523
                properties = {
                    "bldg_id": f"small-{index}",
                    "year_built": year,
                    "age_bucket": "unknown" if year == -1 else str(year),
                    "address": f"{index + 1} TEST ST",
                    "neighborhood": "Test neighborhood",
                    "bldg_use": "House",
                    "bldg_sqft": 172,
                    "num_story": 1,
                }
                expected[properties["bldg_id"]] = properties
                ring = [[lng, lat], [lng + 0.0007, lat],
                        [lng + 0.0007, lat + 0.0005], [lng, lat + 0.0005], [lng, lat]]
                features.append({"type": "Feature", "properties": properties,
                                 "geometry": {"type": "Polygon", "coordinates": [ring]}})
            source.write_text("\n".join(json.dumps(feature) for feature in features) + "\n")
            subprocess.run(["bash", str(ROOT / "scripts/build_tiles.sh"), str(source), str(archive)],
                           check=True, capture_output=True)
            subprocess.run(["pmtiles", "verify", str(archive)], check=True, capture_output=True)
            for zoom in range(10, 17):
                with self.subTest(zoom=zoom):
                    x = int((-122.676 + 180) / 360 * 2**zoom)
                    y = int((1 - math.asinh(math.tan(math.radians(45.523))) / math.pi)
                            / 2 * 2**zoom)
                    result = subprocess.run(
                        ["tippecanoe-decode", str(archive), str(zoom), str(x), str(y)],
                        check=True, capture_output=True, text=True)
                    layers = json.loads(result.stdout)["features"]
                    self.assertEqual(len(layers), 1)
                    self.assertEqual(layers[0]["properties"]["layer"], "buildings")
                    if zoom < 13:
                        overview = layers[0]["features"]
                        self.assertEqual(len(overview), 3)
                        self.assertEqual({feature["properties"]["year_built"] for feature in overview},
                                         {1890, 2020, -1})
                        for feature in overview:
                            self.assertEqual(set(feature["properties"]), {"year_built"})
                        for index, year in enumerate((1890, 1890, 2020, -1)):
                            point = (-122.6784 + index * 0.001 + 0.00035, 45.52325)
                            matches = [feature["properties"]["year_built"] for feature in overview
                                       if covers(feature["geometry"], point)]
                            self.assertTrue(matches)
                            self.assertEqual(set(matches), {year})
                    else:
                        actual = {feature["properties"]["bldg_id"]: feature["properties"]
                                  for feature in layers[0]["features"]}
                        self.assertEqual(actual, expected)
                        self.assertEqual(len(layers[0]["features"]), 4)

    def test_tiny_footprints_retain_aggregate_area(self):
        def projected_area(ring):
            points = [(math.radians(lng), math.asinh(math.tan(math.radians(lat))))
                      for lng, lat in ring]
            return abs(sum(a[0] * b[1] - b[0] * a[1]
                           for a, b in zip(points, points[1:]))) / 2

        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            source = directory / "tiny.ndjson"
            archive = directory / "tiny.pmtiles"
            features = []
            for row in range(40):
                for column in range(40):
                    lng, lat = -122.676 + column * 0.00015, 45.523 + row * 0.0001
                    ring = [[lng, lat], [lng + 0.00005, lat],
                            [lng + 0.00005, lat + 0.000035],
                            [lng, lat + 0.000035], [lng, lat]]
                    features.append({"type": "Feature", "properties": {"year_built": 1900},
                                     "geometry": {"type": "Polygon", "coordinates": [ring]}})
            expected_area = sum(projected_area(f["geometry"]["coordinates"][0]) for f in features)
            source.write_text("\n".join(json.dumps(f) for f in features) + "\n")
            subprocess.run(["bash", str(ROOT / "scripts/build_tiles.sh"), str(source), str(archive)],
                           check=True, capture_output=True)
            for zoom in range(10, 13):
                with self.subTest(zoom=zoom):
                    x = int((-122.676 + 180) / 360 * 2**zoom)
                    y = int((1 - math.asinh(math.tan(math.radians(45.523))) / math.pi)
                            / 2 * 2**zoom)
                    result = subprocess.run(
                        ["tippecanoe-decode", str(archive), str(zoom), str(x), str(y)],
                        check=True, capture_output=True, text=True)
                    records = json.loads(result.stdout)["features"][0]["features"]
                    area = 0
                    polygons = 0
                    for record in records:
                        self.assertEqual(record["properties"], {"year_built": 1900})
                        geometry = record["geometry"]
                        parts = (geometry["coordinates"] if geometry["type"] == "MultiPolygon"
                                 else [geometry["coordinates"]])
                        polygons += len(parts)
                        area += sum(projected_area(part[0])
                                    - sum(projected_area(hole) for hole in part[1:]) for part in parts)
                    self.assertGreater(area / expected_area, 0.65)
                    self.assertLess(area / expected_area, 1.35)
                    self.assertLess(polygons, len(features))

    def test_does_not_replace_an_archive_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            original = directory / "original.pmtiles"
            original.write_bytes(b"keep this archive")
            link = directory / "output.pmtiles"
            link.symlink_to(original)
            result = subprocess.run(
                ["bash", str(ROOT / "scripts/build_tiles.sh"), "unused.ndjson", str(link)],
                capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Refusing to replace a symlink", result.stderr)
            self.assertEqual(original.read_bytes(), b"keep this archive")

    def test_failed_build_keeps_the_previous_archive(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            archive = directory / "output.pmtiles"
            archive.write_bytes(b"previous archive")
            result = subprocess.run(
                ["bash", str(ROOT / "scripts/build_tiles.sh"),
                 str(directory / "missing.ndjson"), str(archive)],
                capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(archive.read_bytes(), b"previous archive")
            self.assertEqual(list(directory.glob(".build-tiles.*")), [])


if __name__ == "__main__":
    unittest.main()
