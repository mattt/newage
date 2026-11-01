"""Build real tiles and check small footprints and their properties at every zoom."""

import json
import math
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parent.parent


class BuildTilesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        for command in ("tippecanoe", "tile-join", "tippecanoe-decode", "pmtiles"):
            if shutil.which(command) is None:
                raise RuntimeError(f"Install {command} before running tile tests (brew bundle)")

    def test_small_buildings_keep_separate_years_and_popup_properties(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            source = directory / "buildings.ndjson"
            archive = directory / "buildings.pmtiles"
            expected = {}
            features = []
            # These 4-metre footprints are below the old tiny-polygon threshold at z10.
            for index, year in enumerate((1890, 2020, -1)):
                lng, lat = -122.676 + index * 0.00012, 45.523
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
                ring = [[lng, lat], [lng + 0.00005, lat],
                        [lng + 0.00005, lat + 0.000035], [lng, lat + 0.000035], [lng, lat]]
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
                    actual = {feature["properties"]["bldg_id"]: feature["properties"]
                              for feature in layers[0]["features"]}
                    self.assertEqual(actual, expected)
                    self.assertEqual(len(layers[0]["features"]), 3)

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
