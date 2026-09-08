"""Pure parser/manifest tests — no database required."""
from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from tests.helpers import ROOT, load_script

migrate = load_script("migrate")

REQUIRED_BASELINE_MARKERS = (
    "CREATE TABLE IF NOT EXISTS providers",
    "CREATE TABLE IF NOT EXISTS buildings",
    "CREATE TABLE IF NOT EXISTS tiers",
    "CREATE TABLE IF NOT EXISTS directory_updates",
    "CREATE TABLE IF NOT EXISTS provider_pipeline",
    "CREATE TABLE IF NOT EXISTS correction_requests",
    "CREATE TABLE IF NOT EXISTS provider_claims",
    "ADD COLUMN IF NOT EXISTS facilities",
    "ADD COLUMN IF NOT EXISTS last_checked_at",
    "ADD COLUMN IF NOT EXISTS check_source",
    "ADD COLUMN IF NOT EXISTS operator_country",
    "ADD COLUMN IF NOT EXISTS dc_tier",
    "ADD COLUMN IF NOT EXISTS telcos",
    "ADD COLUMN IF NOT EXISTS dc_tech",
    "ADD COLUMN IF NOT EXISTS dc_location",
    "ADD COLUMN IF NOT EXISTS sov_score",
    "ADD COLUMN IF NOT EXISTS oss_score",
)


class TestSqlSplitter(unittest.TestCase):
    def test_splits_plain_statements_and_ignores_semicolons_in_strings(self):
        script = """
        CREATE TABLE t (id int);
        INSERT INTO t VALUES (1);
        INSERT INTO t VALUES ('a;b');
        """
        stmts = migrate.split_sql_statements(script)
        self.assertEqual(len(stmts), 3)
        self.assertIn("'a;b'", stmts[2])

    def test_keeps_dollar_quoted_bodies_intact(self):
        script = """
        CREATE TABLE t (id int);
        DO $$ BEGIN RAISE EXCEPTION 'late boom; still one stmt'; END $$;
        """
        stmts = migrate.split_sql_statements(script)
        self.assertEqual(len(stmts), 2)
        self.assertIn("RAISE EXCEPTION", stmts[1])
        self.assertIn("late boom; still one stmt", stmts[1])

    def test_skips_comment_only_chunks(self):
        script = """
        -- heading
        CREATE TABLE t (id int);
        /* block ; comment */
        """
        stmts = migrate.split_sql_statements(script)
        self.assertEqual(len(stmts), 1)
        self.assertTrue(stmts[0].upper().startswith("CREATE TABLE"))


class TestManifestLedger(unittest.TestCase):
    def setUp(self):
        self.migrations_dir = ROOT / "migrations"
        self.manifest_path = self.migrations_dir / "manifest.json"
        self.baseline = self.migrations_dir / "0001_legacy_baseline.sql"

    def test_manifest_lists_version_1_baseline_with_matching_checksum(self):
        self.assertTrue(self.manifest_path.is_file(), "migrations/manifest.json is required")
        self.assertTrue(self.baseline.is_file(), "migrations/0001_legacy_baseline.sql is required")
        manifest = json.loads(self.manifest_path.read_text())
        self.assertEqual(manifest["schema_version"], 1)
        self.assertEqual(len(manifest["migrations"]), 1)
        row = manifest["migrations"][0]
        self.assertEqual(row["version"], 1)
        self.assertEqual(row["filename"], "0001_legacy_baseline.sql")
        digest = hashlib.sha256(self.baseline.read_bytes()).hexdigest()
        self.assertEqual(row["checksum"], digest)
        loaded = migrate.load_manifest(self.migrations_dir)
        self.assertEqual(loaded.schema_version, 1)
        self.assertEqual(loaded.migrations[0].checksum, digest)

    def test_baseline_sql_assembles_schema_and_ingest_patches(self):
        sql = self.baseline.read_text()
        for marker in REQUIRED_BASELINE_MARKERS:
            self.assertIn(marker, sql, f"baseline missing {marker!r}")
        self.assertNotIn("INSERT INTO providers", sql)
        self.assertNotIn("/home/hermes-prime", sql)

    def test_verify_manifest_fails_closed_on_checksum_drift(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            sql_path = d / "0001_legacy_baseline.sql"
            sql_path.write_text("CREATE TABLE t (id int);\n")
            digest = hashlib.sha256(sql_path.read_bytes()).hexdigest()
            (d / "manifest.json").write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "migrations": [
                            {
                                "version": 1,
                                "filename": "0001_legacy_baseline.sql",
                                "checksum": digest,
                            }
                        ],
                    }
                )
            )
            migrate.verify_manifest(d)
            sql_path.write_text("CREATE TABLE t (id int); -- tampered\n")
            with self.assertRaises(migrate.ManifestError) as ctx:
                migrate.verify_manifest(d)
            self.assertIn("checksum", str(ctx.exception).lower())

    def test_unsupported_newer_schema_version_fails_closed(self):
        with self.assertRaises(migrate.VersionError) as ctx:
            migrate.assert_supported_schema_version(applied_max=99, manifest_max=1)
        msg = str(ctx.exception).lower()
        self.assertIn("unsupported", msg)
        self.assertIn("newer", msg)
        migrate.assert_supported_schema_version(applied_max=None, manifest_max=1)
        migrate.assert_supported_schema_version(applied_max=1, manifest_max=1)

    def test_recorded_checksum_mismatch_fails_closed(self):
        with self.assertRaises(migrate.ChecksumMismatchError) as ctx:
            migrate.assert_checksums_match("aaa", "bbb")
        self.assertIn("checksum", str(ctx.exception).lower())
        migrate.assert_checksums_match("abc", "abc")

    def test_verify_manifest_cli_exits_zero_on_repo_manifest(self):
        rc = migrate.main(["--verify-manifest"])
        self.assertEqual(rc, 0)


class TestMigrateCliSafety(unittest.TestCase):
    def test_apply_requires_explicit_database_url(self):
        with self.assertRaises(SystemExit):
            migrate.main([])
