"""PostgreSQL migration tests. Skip clearly when TEST_DATABASE_URL is absent."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

from tests.helpers import ROOT, load_script

migrate = load_script("migrate")

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "").strip()
SKIP_REASON = (
    "TEST_DATABASE_URL not set; skipping PostgreSQL migration tests "
    "(pure parser/manifest tests still run)"
)

EXPECTED_TABLES = (
    "providers",
    "locations",
    "provider_locations",
    "buildings",
    "provider_buildings",
    "stacks",
    "sovereignty",
    "tiers",
    "sources",
    "directory_updates",
    "provider_pipeline",
    "correction_requests",
    "provider_claims",
    "schema_migrations",
    "legal_entities",
    "provider_entity_relationships",
    "services",
    "offerings",
    "offering_versions",
    "facilities",
    "deployments",
    "deployment_facilities",
    "technologies",
    "technology_versions",
    "technology_deployments",
    "fetch_snapshots",
    "claims",
    "evidence",
    "claim_evidence",
    "proposals",
    "proposal_reviews",
    "revisions",
    "collection_tasks",
    "model_runs",
    "methodology_versions",
    "scoring_runs",
    "score_components",
    "canonical_states",
    "publication_attempts",
    "publication_receipts",
    "change_events",
    "country_registry",
    "trend_series",
    "outlook_assessments",
    "outlook_backtests",
)

CURRENT_VERSIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

BUILDING_PATCH_COLUMNS = (
    "facilities",
    "last_checked_at",
    "check_source",
    "operator_country",
    "dc_tier",
    "telcos",
    "dc_tech",
)


def _connect():
    url = TEST_DATABASE_URL
    if not url:
        raise unittest.SkipTest(SKIP_REASON)
    try:
        import psycopg
    except ImportError as exc:
        raise unittest.SkipTest("psycopg is not installed; skipping PostgreSQL migration tests") from exc
    return psycopg.connect(url)


def _reset(conn) -> None:
    conn.execute("DROP SCHEMA IF EXISTS public CASCADE")
    conn.execute("CREATE SCHEMA public")
    conn.commit()


def _table_names(conn) -> set[str]:
    rows = conn.execute(
        """
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public'
        """
    ).fetchall()
    return {r[0] for r in rows}


def _columns(conn, table: str) -> set[str]:
    rows = conn.execute(
        """
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s
        """,
        (table,),
    ).fetchall()
    return {r[0] for r in rows}


@unittest.skipUnless(TEST_DATABASE_URL, SKIP_REASON)
class TestMigrations(unittest.TestCase):
    def setUp(self):
        self.conn = _connect()
        _reset(self.conn)

    def tearDown(self):
        try:
            self.conn.close()
        except Exception:
            pass

    def test_empty_database_migrates_to_current_schema(self):
        result = migrate.apply_migrations(TEST_DATABASE_URL)
        self.assertEqual(result.applied, CURRENT_VERSIONS)
        tables = _table_names(self.conn)
        for name in EXPECTED_TABLES:
            self.assertIn(name, tables, name)
        views = {
            r[0]
            for r in self.conn.execute(
                "SELECT viewname FROM pg_views WHERE schemaname = 'public'"
            ).fetchall()
        }
        self.assertIn("map_projections", views)
        self.assertIn("verified_trend_facts", views)
        cols = _columns(self.conn, "buildings")
        for col in BUILDING_PATCH_COLUMNS:
            self.assertIn(col, cols, col)
        self.assertIn("map_precision", _columns(self.conn, "locations"))
        rows = self.conn.execute(
            "SELECT version, checksum FROM schema_migrations ORDER BY version"
        ).fetchall()
        self.assertEqual([r[0] for r in rows], CURRENT_VERSIONS)
        expected = hashlib.sha256(
            (ROOT / "migrations" / "0001_legacy_baseline.sql").read_bytes()
        ).hexdigest()
        self.assertEqual(rows[0][1], expected)
        count = self.conn.execute("SELECT count(*) FROM providers").fetchone()[0]
        self.assertEqual(count, 0)

        again = migrate.apply_migrations(TEST_DATABASE_URL)
        self.assertEqual(again.applied, [])

    def test_representative_legacy_schema_upgrades_without_data_loss(self):
        legacy = (ROOT / "tests" / "fixtures" / "sql" / "representative_legacy.sql").read_text()
        with self.conn.transaction():
            for stmt in migrate.split_sql_statements(legacy):
                self.conn.execute(stmt)
        before = self.conn.execute(
            "SELECT id, name, hq_country FROM providers WHERE id = 'legacy-local'"
        ).fetchone()
        self.assertEqual(before[1], "Legacy Local Cloud")
        hall = self.conn.execute(
            "SELECT name, listed FROM buildings WHERE name = 'Legacy Hall'"
        ).fetchone()
        self.assertTrue(hall[1])
        tier_price = self.conn.execute(
            "SELECT price_usd_month FROM tiers WHERE id = 'legacy-local-small'"
        ).fetchone()[0]
        source_status = self.conn.execute(
            "SELECT status FROM sources WHERE provider_id = 'legacy-local'"
        ).fetchone()[0]
        occurred = self.conn.execute(
            "SELECT occurred_at FROM directory_updates WHERE provider_id = 'legacy-local'"
        ).fetchone()[0]
        # SELECTs above open an implicit psycopg transaction; close it so
        # apply_migrations' second connection is not blocked on DDL locks.
        self.conn.commit()

        result = migrate.apply_migrations(TEST_DATABASE_URL)
        self.assertEqual(result.applied, CURRENT_VERSIONS)

        after = self.conn.execute(
            "SELECT id, name, hq_country, website FROM providers WHERE id = 'legacy-local'"
        ).fetchone()
        self.assertEqual(tuple(after[:3]), tuple(before))
        self.assertEqual(
            self.conn.execute("SELECT count(*) FROM providers").fetchone()[0], 1
        )
        self.assertEqual(
            self.conn.execute("SELECT count(*) FROM buildings").fetchone()[0], 1
        )
        self.assertEqual(
            self.conn.execute(
                "SELECT price_usd_month FROM tiers WHERE id = 'legacy-local-small'"
            ).fetchone()[0],
            tier_price,
        )
        self.assertEqual(
            self.conn.execute(
                "SELECT status FROM sources WHERE provider_id = 'legacy-local'"
            ).fetchone()[0],
            source_status,
        )
        self.assertEqual(
            self.conn.execute(
                "SELECT occurred_at FROM directory_updates WHERE provider_id = 'legacy-local'"
            ).fetchone()[0],
            occurred,
        )
        cols = _columns(self.conn, "buildings")
        for col in BUILDING_PATCH_COLUMNS:
            self.assertIn(col, cols, col)
        for name in ("provider_pipeline", "correction_requests", "provider_claims"):
            self.assertIn(name, _table_names(self.conn))
        self.assertIsNone(
            self.conn.execute(
                "SELECT facilities FROM buildings WHERE name = 'Legacy Hall'"
            ).fetchone()[0]
        )

    def test_checksum_mismatch_fails_closed(self):
        migrate.apply_migrations(TEST_DATABASE_URL)
        self.conn.execute(
            "UPDATE schema_migrations SET checksum = %s WHERE version = 1",
            ("0" * 64,),
        )
        self.conn.commit()
        with self.assertRaises(migrate.ChecksumMismatchError):
            migrate.apply_migrations(TEST_DATABASE_URL)
        self.assertIn("providers", _table_names(self.conn))
        stored = self.conn.execute(
            "SELECT checksum FROM schema_migrations WHERE version = 1"
        ).fetchone()[0]
        self.assertEqual(stored, "0" * 64)

    def test_late_failure_rolls_back_fully(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            src = ROOT / "migrations" / "0001_legacy_baseline.sql"
            shutil.copy(src, d / "0001_legacy_baseline.sql")
            failing = (
                "CREATE TABLE migrate_probe (id int);\n"
                "INSERT INTO migrate_probe VALUES (1);\n"
                "DO $$ BEGIN RAISE EXCEPTION 'late boom'; END $$;\n"
            )
            (d / "0002_fail_late.sql").write_text(failing)
            manifest = {
                "schema_version": 2,
                "migrations": [
                    {
                        "version": 1,
                        "filename": "0001_legacy_baseline.sql",
                        "checksum": hashlib.sha256(src.read_bytes()).hexdigest(),
                    },
                    {
                        "version": 2,
                        "filename": "0002_fail_late.sql",
                        "checksum": hashlib.sha256(failing.encode()).hexdigest(),
                    },
                ],
            }
            (d / "manifest.json").write_text(json.dumps(manifest))
            with self.assertRaises(migrate.MigrationError):
                migrate.apply_migrations(TEST_DATABASE_URL, migrations_dir=d)
            versions = [
                r[0]
                for r in self.conn.execute(
                    "SELECT version FROM schema_migrations ORDER BY version"
                ).fetchall()
            ]
            self.assertEqual(versions, [1])
            self.assertNotIn("migrate_probe", _table_names(self.conn))
            self.assertIn("providers", _table_names(self.conn))

    def test_unsupported_newer_schema_version_fails_closed(self):
        migrate.apply_migrations(TEST_DATABASE_URL)
        manifest = migrate.verify_manifest(ROOT / "migrations")
        expected_versions = list(range(1, manifest.schema_version + 1)) + [99]
        self.conn.execute(
            """
            INSERT INTO schema_migrations (version, name, checksum)
            VALUES (99, 'future.sql', %s)
            """,
            ("f" * 64,),
        )
        self.conn.commit()
        before = self.conn.execute(
            "SELECT version, name, checksum FROM schema_migrations ORDER BY version"
        ).fetchall()
        self.assertEqual([r[0] for r in before], expected_versions)
        with self.assertRaises(migrate.VersionError) as ctx:
            migrate.apply_migrations(TEST_DATABASE_URL)
        self.assertIn("unsupported", str(ctx.exception).lower())
        self.assertIn("newer", str(ctx.exception).lower())
        after = self.conn.execute(
            "SELECT version, name, checksum FROM schema_migrations ORDER BY version"
        ).fetchall()
        self.assertEqual([r[0] for r in after], expected_versions)
        self.assertEqual(list(after), list(before))

    def test_country_registry_and_outlook_forecast_gate(self):
        migrate.apply_migrations(TEST_DATABASE_URL)
        asean = self.conn.execute(
            "SELECT count(*) FROM country_registry WHERE asean"
        ).fetchone()[0]
        self.assertEqual(asean, 10)
        self.assertIn(
            "verified_trend_facts",
            {
                r[0]
                for r in self.conn.execute(
                    "SELECT viewname FROM pg_views WHERE schemaname = 'public'"
                ).fetchall()
            },
        )
        with self.assertRaises(Exception):
            self.conn.execute(
                """
                INSERT INTO outlook_assessments (
                  id, metric, observation_window_start, observation_window_end,
                  observed_fact, measured_trend, signal, assessment, forecast,
                  confidence_label, model_version, ruleset_version, ruleset_hash,
                  data_revision, expires_at, eligibility_passed, publication_state
                ) VALUES (
                  'ol-1', 'provider_count_by_country', now(), now(),
                  '{"layer":"observed_fact"}'::jsonb,
                  '{"layer":"measured_trend"}'::jsonb,
                  '{"layer":"signal"}'::jsonb,
                  '{"layer":"assessment"}'::jsonb,
                  '{"layer":"forecast"}'::jsonb,
                  'insufficient', '1.0.0', 'asean-trend-series-v1', %s,
                  'drv', now(), false, 'insufficient_evidence'
                )
                """,
                ("a" * 64,),
            )
        self.conn.rollback()
        count = self.conn.execute("SELECT count(*) FROM outlook_assessments").fetchone()[0]
        self.assertEqual(count, 0)

    def test_trend_series_nulls_not_distinct_and_outlook_layer_values(self):
        migrate.apply_migrations(TEST_DATABASE_URL)
        digest = "a" * 64
        self.conn.execute(
            """
            INSERT INTO trend_series (
              id, metric, country_iso2, provider_id, period_start, period_end, value,
              observation_count, comparable_population, missingness, continuity,
              revision_quality, methodology_version, methodology_hash, data_revision
            ) VALUES (
              'ts-1', 'provider_count_by_country', NULL, NULL,
              '2025-01-01T00:00:00Z', '2025-02-01T00:00:00Z', 1,
              1, 1, 0, 1, 1, 'asean-trend-series-v1', %s, 'drv'
            )
            """,
            (digest,),
        )
        self.conn.commit()
        with self.assertRaises(Exception):
            self.conn.execute(
                """
                INSERT INTO trend_series (
                  id, metric, country_iso2, provider_id, period_start, period_end, value,
                  observation_count, comparable_population, missingness, continuity,
                  revision_quality, methodology_version, methodology_hash, data_revision
                ) VALUES (
                  'ts-2', 'provider_count_by_country', NULL, NULL,
                  '2025-01-01T00:00:00Z', '2025-02-01T00:00:00Z', 2,
                  1, 1, 0, 1, 1, 'asean-trend-series-v1', %s, 'drv'
                )
                """,
                (digest,),
            )
        self.conn.rollback()
        with self.assertRaises(Exception):
            self.conn.execute(
                """
                INSERT INTO outlook_assessments (
                  id, metric, observation_window_start, observation_window_end,
                  observed_fact, measured_trend, signal, assessment,
                  confidence_label, model_version, ruleset_version, ruleset_hash,
                  data_revision, expires_at, eligibility_passed, publication_state
                ) VALUES (
                  'ol-bad-layer', 'provider_count_by_country', now(), now(),
                  '{"layer":"forecast"}'::jsonb,
                  '{"layer":"measured_trend"}'::jsonb,
                  '{"layer":"signal"}'::jsonb,
                  '{"layer":"assessment"}'::jsonb,
                  'insufficient', '1.1.0', 'asean-trend-series-v1', %s,
                  'drv', now(), false, 'insufficient_evidence'
                )
                """,
                (digest,),
            )
        self.conn.rollback()
        with self.assertRaises(Exception):
            self.conn.execute(
                """
                INSERT INTO outlook_assessments (
                  id, metric, observation_window_start, observation_window_end,
                  observed_fact, measured_trend, signal, assessment, forecast,
                  confidence_label, confidence_low, confidence_high,
                  model_version, ruleset_version, ruleset_hash,
                  data_revision, expires_at, eligibility_passed, publication_state
                ) VALUES (
                  'ol-bad-bounds', 'provider_count_by_country', now(), now(),
                  '{"layer":"observed_fact"}'::jsonb,
                  '{"layer":"measured_trend"}'::jsonb,
                  '{"layer":"signal"}'::jsonb,
                  '{"layer":"assessment"}'::jsonb,
                  '{"layer":"forecast","pointEstimate":1}'::jsonb,
                  'medium', 2, 1,
                  '1.1.0', 'asean-trend-series-v1', %s,
                  'drv', now(), true, 'not_published'
                )
                """,
                (digest,),
            )
        self.conn.rollback()
        self.conn.execute(
            """
            INSERT INTO outlook_assessments (
              id, metric, observation_window_start, observation_window_end,
              observed_fact, measured_trend, signal, assessment,
              confidence_label, model_version, ruleset_version, ruleset_hash,
              data_revision, expires_at, eligibility_passed, publication_state
            ) VALUES (
              'ol-ok', 'provider_count_by_country', now(), now(),
              '{"layer":"observed_fact"}'::jsonb,
              '{"layer":"measured_trend"}'::jsonb,
              '{"layer":"signal"}'::jsonb,
              '{"layer":"assessment"}'::jsonb,
              'insufficient', '1.1.0', 'asean-trend-series-v1', %s,
              'drv', now(), false, 'insufficient_evidence'
            )
            """,
            (digest,),
        )
        self.conn.commit()
        self.assertEqual(
            self.conn.execute("SELECT count(*) FROM outlook_assessments WHERE id = 'ol-ok'").fetchone()[0],
            1,
        )


class TestMigrationsSkipContract(unittest.TestCase):
    def test_skip_reason_names_test_database_url(self):
        self.assertIn("TEST_DATABASE_URL", SKIP_REASON)
        self.assertTrue(SKIP_REASON.startswith("TEST_DATABASE_URL not set") or TEST_DATABASE_URL)
