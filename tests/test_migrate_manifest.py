"""Pure parser/manifest tests — no database required."""
from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from tests.helpers import ROOT, load_script

migrate = load_script("migrate")

REQUIRED_PHASE2_MARKERS = (
    ("0002_entities_services_offerings.sql", "CREATE TABLE IF NOT EXISTS legal_entities"),
    ("0002_entities_services_offerings.sql", "CREATE TABLE IF NOT EXISTS provider_entity_relationships"),
    ("0002_entities_services_offerings.sql", "CREATE TABLE IF NOT EXISTS services"),
    ("0002_entities_services_offerings.sql", "CREATE TABLE IF NOT EXISTS offerings"),
    ("0002_entities_services_offerings.sql", "CREATE TABLE IF NOT EXISTS offering_versions"),
    ("0003_locations_facilities_deployments.sql", "map_precision"),
    ("0003_locations_facilities_deployments.sql", "CREATE TABLE IF NOT EXISTS facilities"),
    ("0003_locations_facilities_deployments.sql", "CREATE TABLE IF NOT EXISTS deployments"),
    ("0003_locations_facilities_deployments.sql", "CREATE TABLE IF NOT EXISTS deployment_facilities"),
    ("0003_locations_facilities_deployments.sql", "CREATE OR REPLACE VIEW map_projections"),
    ("0004_technologies.sql", "CREATE TABLE IF NOT EXISTS technologies"),
    ("0004_technologies.sql", "CREATE TABLE IF NOT EXISTS technology_versions"),
    ("0004_technologies.sql", "CREATE TABLE IF NOT EXISTS technology_deployments"),
    ("0004_technologies.sql", "has_universal_scope_evidence"),
    ("0005_claims_evidence_snapshots.sql", "CREATE TABLE IF NOT EXISTS fetch_snapshots"),
    ("0005_claims_evidence_snapshots.sql", "CREATE TABLE IF NOT EXISTS claims"),
    ("0005_claims_evidence_snapshots.sql", "CREATE TABLE IF NOT EXISTS evidence"),
    ("0005_claims_evidence_snapshots.sql", "CREATE TABLE IF NOT EXISTS claim_evidence"),
    ("0005_claims_evidence_snapshots.sql", "knowledge_state"),
    ("0005_claims_evidence_snapshots.sql", "legacy/unverified"),
    ("0006_proposals_reviews_revisions.sql", "CREATE TABLE IF NOT EXISTS proposals"),
    ("0006_proposals_reviews_revisions.sql", "CREATE TABLE IF NOT EXISTS proposal_reviews"),
    ("0006_proposals_reviews_revisions.sql", "CREATE TABLE IF NOT EXISTS revisions"),
    ("0006_proposals_reviews_revisions.sql", "body_digest"),
    ("0006_proposals_reviews_revisions.sql", "idempotency_key"),
    ("0006_proposals_reviews_revisions.sql", "proposal cannot self-approve"),
    ("0006_proposals_reviews_revisions.sql", r"^[a-z][a-z0-9_-]{0,63}$"),
    ("0007_collection_pipeline.sql", "CREATE TABLE IF NOT EXISTS collection_tasks"),
    ("0007_collection_pipeline.sql", "CREATE TABLE IF NOT EXISTS model_runs"),
    ("0007_collection_pipeline.sql", "lease_owner"),
    ("0007_collection_pipeline.sql", "input_digest"),
    ("0008_scoring_runs.sql", "CREATE TABLE IF NOT EXISTS methodology_versions"),
    ("0008_scoring_runs.sql", "CREATE TABLE IF NOT EXISTS scoring_runs"),
    ("0008_scoring_runs.sql", "CREATE TABLE IF NOT EXISTS score_components"),
    ("0008_scoring_runs.sql", "ruleset_hash"),
    ("0008_scoring_runs.sql", "asean-offering-deployment-v1"),
    ("0008_scoring_runs.sql", "evidence_readiness"),
    ("0008_scoring_runs.sql", "ranking_lower_bound"),
    ("0009_publication_ledger.sql", "CREATE TABLE IF NOT EXISTS canonical_states"),
    ("0009_publication_ledger.sql", "CREATE TABLE IF NOT EXISTS publication_attempts"),
    ("0009_publication_ledger.sql", "CREATE TABLE IF NOT EXISTS publication_receipts"),
    ("0009_publication_ledger.sql", "CREATE TABLE IF NOT EXISTS change_events"),
    ("0009_publication_ledger.sql", "bound_revision_id"),
    ("0009_publication_ledger.sql", "approval_digest"),
    ("0009_publication_ledger.sql", "proposal author cannot publish own proposal"),
    ("0009_publication_ledger.sql", "DEFAULT 'pending'"),
    ("0009_publication_ledger.sql", "publication attempt identity is immutable"),
    ("0009_publication_ledger.sql", "publication attempt state cannot regress"),
    ("0009_publication_ledger.sql", "publication receipt history cannot be rewritten"),
    ("0009_publication_ledger.sql", "verified_by"),
    ("0010_trend_series_outlook.sql", "CREATE TABLE IF NOT EXISTS country_registry"),
    ("0010_trend_series_outlook.sql", "CREATE TABLE IF NOT EXISTS trend_series"),
    ("0010_trend_series_outlook.sql", "CREATE TABLE IF NOT EXISTS outlook_assessments"),
    ("0010_trend_series_outlook.sql", "CREATE TABLE IF NOT EXISTS outlook_backtests"),
    ("0010_trend_series_outlook.sql", "CREATE OR REPLACE VIEW verified_trend_facts"),
    ("0010_trend_series_outlook.sql", "forecast cannot be stored when eligibility gates fail"),
    ("0010_trend_series_outlook.sql", "UNIQUE NULLS NOT DISTINCT"),
    ("0010_trend_series_outlook.sql", "observed_fact->>'layer' = 'observed_fact'"),
    ("0010_trend_series_outlook.sql", "forecast->>'layer' = 'forecast'"),
    ("0010_trend_series_outlook.sql", "(forecast IS NULL) = (confidence_low IS NULL)"),
    ("0011_sod_state_replay.sql", "proposal_reviews_approve_binding"),
    ("0011_sod_state_replay.sql", "revision author cannot self-approve"),
    ("0011_sod_state_replay.sql", "proposal_status_transition_allowed"),
    ("0011_sod_state_replay.sql", "illegal proposal status transition"),
    ("0016_collection_submission_outcomes.sql", "CREATE TABLE IF NOT EXISTS collection_submission_outcomes"),
    ("0016_collection_submission_outcomes.sql", "collection_submission_outcomes are append-only"),
    ("0016_collection_submission_outcomes.sql", "rejected or ambiguous required submissions prevent proposed"),
    ("0016_collection_submission_outcomes.sql", "cannot insert submission outcome after task is proposed"),
    ("0016_collection_submission_outcomes.sql", "required submission count cap exceeded"),
    ("0017_current_claim_knowledge_conflicts.sql", "jsonb_build_array(a.knowledge_state, a.value)"),
)

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

    def test_manifest_lists_contiguous_phase3_migrations_with_matching_checksums(self):
        self.assertTrue(self.manifest_path.is_file(), "migrations/manifest.json is required")
        self.assertTrue(self.baseline.is_file(), "migrations/0001_legacy_baseline.sql is required")
        expected_files = [
            "0001_legacy_baseline.sql",
            "0002_entities_services_offerings.sql",
            "0003_locations_facilities_deployments.sql",
            "0004_technologies.sql",
            "0005_claims_evidence_snapshots.sql",
            "0006_proposals_reviews_revisions.sql",
            "0007_collection_pipeline.sql",
            "0008_scoring_runs.sql",
            "0009_publication_ledger.sql",
            "0010_trend_series_outlook.sql",
            "0011_sod_state_replay.sql",
            "0012_typed_publication_state.sql",
            "0013_immutable_data_revisions.sql",
            "0014_structured_price_terms.sql",
            "0015_current_claims.sql",
            "0016_collection_submission_outcomes.sql",
            "0017_current_claim_knowledge_conflicts.sql",
        ]
        manifest = json.loads(self.manifest_path.read_text())
        self.assertEqual(manifest["schema_version"], 17)
        self.assertEqual(len(manifest["migrations"]), 17)
        for i, filename in enumerate(expected_files, start=1):
            row = manifest["migrations"][i - 1]
            self.assertEqual(row["version"], i)
            self.assertEqual(row["filename"], filename)
            path = self.migrations_dir / filename
            self.assertTrue(path.is_file(), filename)
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            self.assertEqual(row["checksum"], digest)
        loaded = migrate.load_manifest(self.migrations_dir)
        self.assertEqual(loaded.schema_version, 17)
        self.assertEqual([m.filename for m in loaded.migrations], expected_files)
        self.assertEqual(loaded.migrations[0].checksum, hashlib.sha256(self.baseline.read_bytes()).hexdigest())

    def test_baseline_sql_assembles_schema_and_ingest_patches(self):
        sql = self.baseline.read_text()
        for marker in REQUIRED_BASELINE_MARKERS:
            self.assertIn(marker, sql, f"baseline missing {marker!r}")
        self.assertNotIn("INSERT INTO providers", sql)
        self.assertNotIn("/home/hermes-prime", sql)

    def test_phase2_sql_defines_catalog_geography_technology_and_claims(self):
        for filename, marker in REQUIRED_PHASE2_MARKERS:
            sql = (self.migrations_dir / filename).read_text()
            self.assertIn(marker, sql, f"{filename} missing {marker!r}")
            self.assertNotIn("/home/hermes-prime", sql)
            self.assertNotIn("INSERT INTO providers", sql)

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
        migrate.assert_supported_schema_version(applied_max=5, manifest_max=5)
        migrate.assert_supported_schema_version(applied_max=6, manifest_max=6)
        migrate.assert_supported_schema_version(applied_max=7, manifest_max=7)
        migrate.assert_supported_schema_version(applied_max=8, manifest_max=8)
        migrate.assert_supported_schema_version(applied_max=9, manifest_max=9)
        migrate.assert_supported_schema_version(applied_max=10, manifest_max=10)
        migrate.assert_supported_schema_version(applied_max=11, manifest_max=11)

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
