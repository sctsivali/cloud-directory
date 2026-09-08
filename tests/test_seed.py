"""Seed CLI, stable IDs, and removal of hardcoded external paths."""
from __future__ import annotations

import ast
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from tests.helpers import ROOT, load_script

seed = load_script("seed")
daily_refresh = load_script("daily_refresh")


def _builtin_hash_calls(path: Path) -> list[int]:
    tree = ast.parse(path.read_text())
    lines = []
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "hash"
        ):
            lines.append(getattr(node, "lineno", 0))
    return lines


class TestSeedStableIds(unittest.TestCase):
    def test_does_not_use_builtin_hash(self):
        self.assertEqual(_builtin_hash_calls(ROOT / "scripts" / "seed.py"), [])

    def test_requires_explicit_input_path(self):
        src = (ROOT / "scripts" / "seed.py").read_text()
        self.assertNotIn("/home/hermes-prime", src)
        with self.assertRaises(SystemExit):
            seed.parse_args([])

    def test_preserves_explicit_ids_and_derives_stable_ids(self):
        data = json.loads((ROOT / "tests" / "fixtures" / "seed" / "minimal.json").read_text())
        rows = data["rows"]
        first = seed.stable_tier_id("fixture_cloud", rows[0])
        again = seed.stable_tier_id("fixture_cloud", rows[0])
        self.assertEqual(first, again)
        self.assertTrue(first.startswith("fixture_cloud_"))
        self.assertNotEqual(first, str(abs(hash(rows[0].get("tier_name")))))
        self.assertEqual(seed.stable_tier_id("fixture_cloud", rows[1]), "explicit-id-1")

    def test_sql_is_deterministic_across_hash_seeds(self):
        fixture = ROOT / "tests" / "fixtures" / "seed" / "minimal.json"
        script = ROOT / "scripts" / "seed.py"
        outputs = []
        for hashseed in ("0", "1", "4294967295"):
            env = {**os.environ, "PYTHONHASHSEED": hashseed, "PYTHONPATH": ""}
            proc = subprocess.run(
                [sys.executable, str(script), str(fixture)],
                check=True,
                capture_output=True,
                text=True,
                cwd=str(ROOT),
                env=env,
            )
            outputs.append(proc.stdout)
        self.assertEqual(outputs[0], outputs[1])
        self.assertEqual(outputs[1], outputs[2])
        self.assertIn("INSERT INTO providers", outputs[0])
        self.assertIn("explicit-id-1", outputs[0])
        self.assertNotIn("None", [line for line in outputs[0].splitlines() if "INSERT INTO tiers" in line][0])

    def test_cli_rejects_missing_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing = Path(tmp) / "nope.json"
            rc = seed.main([str(missing)])
            self.assertNotEqual(rc, 0)


class TestDailyRefreshPaths(unittest.TestCase):
    def test_removes_hardcoded_home_paths(self):
        src = (ROOT / "scripts" / "daily_refresh.py").read_text()
        self.assertNotIn("/home/hermes-prime", src)

    def test_root_comes_from_cli_or_repository_layout(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "data" / "ingest").mkdir(parents=True)
            (root / "scripts").mkdir()
            paths = daily_refresh.paths_from_args(
                daily_refresh.parse_args(["--root", str(root)])
            )
            self.assertEqual(paths.root, root.resolve())
            self.assertEqual(paths.ingest, (root / "data" / "ingest").resolve())
            self.assertEqual(paths.gate, (root / "scripts" / "ingest_provider.py").resolve())
            self.assertEqual(paths.candidates, (root / "data" / "uncovered-candidates.csv").resolve())

        default_paths = daily_refresh.paths_from_args(daily_refresh.parse_args([]))
        self.assertEqual(default_paths.root, ROOT.resolve())
        self.assertEqual(default_paths.ingest, (ROOT / "data" / "ingest").resolve())

    def test_default_main_refuses_direct_canonical_writes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "data" / "ingest").mkdir(parents=True)
            (root / "scripts").mkdir()
            rc = daily_refresh.main(["--root", str(root)])
            self.assertEqual(rc, 2)
        src = (ROOT / "scripts" / "daily_refresh.py").read_text()
        self.assertIn("workers.orchestrator", src)
        self.assertIn("--legacy-direct-write", src)
