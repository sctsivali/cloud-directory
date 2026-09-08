"""PostgreSQL legacy-row migration tests. Skip clearly when TEST_DATABASE_URL is absent."""
from __future__ import annotations

import os
import unittest
from datetime import datetime, timezone

from tests.helpers import ROOT, load_script

migrate = load_script("migrate")
legacy = load_script("migrate_legacy_data")

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "").strip()
SKIP_REASON = (
    "TEST_DATABASE_URL not set; skipping PostgreSQL legacy data migration tests "
    "(pure parser/manifest tests still run)"
)

PUBLIC_TABLES = (
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
)


def _connect():
    url = TEST_DATABASE_URL
    if not url:
        raise unittest.SkipTest(SKIP_REASON)
    try:
        import psycopg
    except ImportError as exc:
        raise unittest.SkipTest("psycopg is not installed; skipping PostgreSQL tests") from exc
    return psycopg.connect(url)


def _reset(conn) -> None:
    conn.execute("DROP SCHEMA IF EXISTS public CASCADE")
    conn.execute("CREATE SCHEMA public")
    conn.commit()


def _load_representative(conn) -> None:
    sql = (ROOT / "tests" / "fixtures" / "sql" / "representative_legacy.sql").read_text()
    with conn.transaction():
        for stmt in migrate.split_sql_statements(sql):
            conn.execute(stmt)
    conn.commit()


def _public_snapshot(conn) -> dict:
    snap = {}
    for table in PUBLIC_TABLES:
        rows = conn.execute(f"SELECT * FROM {table} ORDER BY 1").fetchall()
        cols = [c.name for c in conn.execute(f"SELECT * FROM {table} LIMIT 0").description]
        snap[table] = {"columns": cols, "rows": [tuple(r) for r in rows]}
    return snap


@unittest.skipUnless(TEST_DATABASE_URL, SKIP_REASON)
class TestLegacyDataMigration(unittest.TestCase):
    def setUp(self):
        self.conn = _connect()
        _reset(self.conn)
        _load_representative(self.conn)
        # Close implicit txn so schema migrations on another connection can take locks.
        self.conn.commit()
        migrate.apply_migrations(TEST_DATABASE_URL)
        self.conn.commit()

    def tearDown(self):
        try:
            self.conn.close()
        except Exception:
            pass

    def test_preserves_lineage_legacy_state_timestamps_and_refuses_fabrication(self):
        before_public = _public_snapshot(self.conn)
        created_at = self.conn.execute(
            "SELECT created_at FROM providers WHERE id = 'legacy-local'"
        ).fetchone()[0]
        tier_updated = self.conn.execute(
            "SELECT updated_at FROM tiers WHERE id = 'legacy-local-small'"
        ).fetchone()[0]
        scraped_at = self.conn.execute(
            "SELECT scraped_at FROM sources WHERE provider_id = 'legacy-local'"
        ).fetchone()[0]
        occurred_at = self.conn.execute(
            "SELECT occurred_at FROM directory_updates WHERE provider_id = 'legacy-local'"
        ).fetchone()[0]
        loc_coords = self.conn.execute(
            "SELECT lat, lng FROM locations WHERE city = 'Jakarta' AND country = 'Indonesia'"
        ).fetchone()
        self.conn.commit()

        first = legacy.migrate_legacy_data(TEST_DATABASE_URL)
        self.conn.commit()

        offering = self.conn.execute(
            """
            SELECT id, name, legacy_table, legacy_pk, assessment_state
            FROM offerings WHERE legacy_table = 'tiers' AND legacy_pk = 'legacy-local-small'
            """
        ).fetchone()
        self.assertIsNotNone(offering)
        self.assertEqual(offering[1], "Small")
        self.assertEqual(offering[4], "legacy/unverified")

        version = self.conn.execute(
            """
            SELECT observed_at, recorded_at, assessment_state, attributes
            FROM offering_versions WHERE offering_id = %s
            """,
            (offering[0],),
        ).fetchone()
        self.assertEqual(version[0], tier_updated)
        self.assertNotEqual(version[0], version[1])
        self.assertEqual(version[2], "legacy/unverified")
        attrs = version[3]
        self.assertEqual(float(attrs["price_usd_month"]), 5.0)
        self.assertEqual(attrs["currency"], "IDR")

        facility = self.conn.execute(
            """
            SELECT map_precision, lat, lng, legacy_table, legacy_pk, name
            FROM facilities WHERE legacy_table = 'buildings'
            """
        ).fetchone()
        self.assertIsNotNone(facility)
        self.assertEqual(facility[0], "undisclosed")
        self.assertEqual(facility[3], "buildings")
        self.assertEqual(facility[5], "Legacy Hall")

        loc_precision = self.conn.execute(
            """
            SELECT map_precision, lat, lng FROM locations
            WHERE city = 'Jakarta' AND country = 'Indonesia'
            """
        ).fetchone()
        self.assertEqual(loc_precision[0], "undisclosed")
        self.assertEqual(tuple(loc_precision[1:]), tuple(loc_coords))

        exact_pins = self.conn.execute(
            "SELECT count(*) FROM map_projections WHERE is_exact_pin"
        ).fetchone()[0]
        self.assertEqual(exact_pins, 0)

        legal_count = self.conn.execute("SELECT count(*) FROM legal_entities").fetchone()[0]
        self.assertEqual(legal_count, 0)
        rel_count = self.conn.execute(
            "SELECT count(*) FROM provider_entity_relationships"
        ).fetchone()[0]
        self.assertEqual(rel_count, 0)

        legal_claim = self.conn.execute(
            """
            SELECT knowledge_state, assessment_state, observed_at, value, legacy_table, legacy_column
            FROM claims
            WHERE legacy_table = 'providers' AND legacy_pk = 'legacy-local'
              AND legacy_column = 'legal_country'
            """
        ).fetchone()
        self.assertIsNotNone(legal_claim)
        self.assertEqual(legal_claim[0], "present")
        self.assertEqual(legal_claim[1], "legacy/unverified")
        self.assertIsNone(legal_claim[2], "do not fabricate an observation time for legal_country")
        self.assertEqual(legal_claim[3]["text"], "Indonesia")

        tech = self.conn.execute(
            """
            SELECT td.scope, td.has_universal_scope_evidence, td.legacy_table, t.slug
            FROM technology_deployments td
            JOIN technologies t ON t.id = td.technology_id
            WHERE td.legacy_table = 'stacks' AND td.legacy_pk = 'legacy-local'
            """
        ).fetchone()
        self.assertIsNotNone(tech)
        self.assertEqual(tech[0], "provider")
        self.assertFalse(tech[1])
        self.assertEqual(tech[3], "kvm")

        snapshots = self.conn.execute("SELECT count(*) FROM fetch_snapshots").fetchone()[0]
        evidence = self.conn.execute("SELECT count(*) FROM evidence").fetchone()[0]
        self.assertEqual(snapshots, 0)
        self.assertEqual(evidence, 0)

        source_claim = self.conn.execute(
            """
            SELECT observed_at, assessment_state, knowledge_state
            FROM claims
            WHERE legacy_table = 'sources' AND legacy_column = 'url'
            """
        ).fetchone()
        self.assertIsNotNone(source_claim)
        self.assertEqual(source_claim[0], scraped_at)
        self.assertEqual(source_claim[1], "legacy/unverified")
        self.assertEqual(source_claim[2], "present")

        hypervisor_claim = self.conn.execute(
            """
            SELECT knowledge_state, assessment_state, observed_at, value
            FROM claims
            WHERE legacy_table = 'stacks' AND legacy_pk = 'legacy-local'
              AND legacy_column = 'hypervisor'
            """
        ).fetchone()
        self.assertEqual(hypervisor_claim[0], "present")
        self.assertEqual(hypervisor_claim[1], "legacy/unverified")
        self.assertIsNone(hypervisor_claim[2])
        self.assertEqual(hypervisor_claim[3]["text"], "KVM")

        after_created = self.conn.execute(
            "SELECT created_at FROM providers WHERE id = 'legacy-local'"
        ).fetchone()[0]
        after_scraped = self.conn.execute(
            "SELECT scraped_at FROM sources WHERE provider_id = 'legacy-local'"
        ).fetchone()[0]
        after_occurred = self.conn.execute(
            "SELECT occurred_at FROM directory_updates WHERE provider_id = 'legacy-local'"
        ).fetchone()[0]
        after_tier = self.conn.execute(
            "SELECT updated_at FROM tiers WHERE id = 'legacy-local-small'"
        ).fetchone()[0]
        self.assertEqual(after_created, created_at)
        self.assertEqual(after_scraped, scraped_at)
        self.assertEqual(after_occurred, occurred_at)
        self.assertEqual(after_tier, tier_updated)
        self.assertEqual(after_scraped, datetime(2024, 1, 15, tzinfo=timezone.utc))

        after_public = _public_snapshot(self.conn)
        for table in PUBLIC_TABLES:
            before_cols = set(before_public[table]["columns"])
            after_cols = set(after_public[table]["columns"])
            self.assertTrue(before_cols <= after_cols, table)
            self.assertEqual(len(before_public[table]["rows"]), len(after_public[table]["rows"]), table)
            # Compare shared columns only; new nullable columns on public tables are allowed.
            before_idx = {c: i for i, c in enumerate(before_public[table]["columns"])}
            after_idx = {c: i for i, c in enumerate(after_public[table]["columns"])}
            for brow, arow in zip(before_public[table]["rows"], after_public[table]["rows"]):
                for col in before_cols:
                    self.assertEqual(brow[before_idx[col]], arow[after_idx[col]], f"{table}.{col}")

        counts = {
            "offerings": self.conn.execute("SELECT count(*) FROM offerings").fetchone()[0],
            "offering_versions": self.conn.execute("SELECT count(*) FROM offering_versions").fetchone()[0],
            "facilities": self.conn.execute("SELECT count(*) FROM facilities").fetchone()[0],
            "deployments": self.conn.execute("SELECT count(*) FROM deployments").fetchone()[0],
            "claims": self.conn.execute("SELECT count(*) FROM claims").fetchone()[0],
            "technologies": self.conn.execute("SELECT count(*) FROM technologies").fetchone()[0],
            "technology_deployments": self.conn.execute(
                "SELECT count(*) FROM technology_deployments"
            ).fetchone()[0],
        }
        self.assertGreaterEqual(counts["offerings"], 1)
        self.assertGreaterEqual(counts["claims"], 1)

        second = legacy.migrate_legacy_data(TEST_DATABASE_URL)
        self.conn.commit()
        self.assertEqual(
            self.conn.execute("SELECT count(*) FROM offerings").fetchone()[0],
            counts["offerings"],
        )
        self.assertEqual(
            self.conn.execute("SELECT count(*) FROM offering_versions").fetchone()[0],
            counts["offering_versions"],
        )
        self.assertEqual(
            self.conn.execute("SELECT count(*) FROM facilities").fetchone()[0],
            counts["facilities"],
        )
        self.assertEqual(
            self.conn.execute("SELECT count(*) FROM deployments").fetchone()[0],
            counts["deployments"],
        )
        self.assertEqual(
            self.conn.execute("SELECT count(*) FROM claims").fetchone()[0],
            counts["claims"],
        )
        self.assertEqual(
            self.conn.execute("SELECT count(*) FROM technologies").fetchone()[0],
            counts["technologies"],
        )
        self.assertEqual(
            self.conn.execute("SELECT count(*) FROM technology_deployments").fetchone()[0],
            counts["technology_deployments"],
        )
        self.assertEqual(
            self.conn.execute("SELECT count(*) FROM legal_entities").fetchone()[0],
            0,
        )
        self.assertEqual(
            self.conn.execute("SELECT count(*) FROM fetch_snapshots").fetchone()[0],
            0,
        )
        self.assertEqual(first.offerings, second.offerings)
        self.assertEqual(first.claims, second.claims)

        observed_again = self.conn.execute(
            "SELECT observed_at FROM offering_versions WHERE offering_id = %s",
            (offering[0],),
        ).fetchone()[0]
        self.assertEqual(observed_again, tier_updated)

        loc_after = self.conn.execute(
            """
            SELECT map_precision FROM locations
            WHERE city = 'Jakarta' AND country = 'Indonesia'
            """
        ).fetchone()[0]
        self.assertEqual(loc_after, "undisclosed")

    def test_fetch_snapshots_are_immutable_and_excerpt_must_match_body(self):
        self.conn.execute(
            """
            INSERT INTO fetch_snapshots (
              id, source_url, fetched_at, http_status, content_sha256, body, byte_length
            ) VALUES (
              'snap-test', 'https://legacy-local.example.test/page',
              '2024-01-15T00:00:00Z', 200, %s, 'KVM is offered in Jakarta.', 24
            )
            """,
            ("a" * 64,),
        )
        self.conn.commit()
        with self.assertRaises(Exception):
            self.conn.execute(
                "UPDATE fetch_snapshots SET body = 'tampered' WHERE id = 'snap-test'"
            )
        self.conn.rollback()
        with self.assertRaises(Exception):
            self.conn.execute("DELETE FROM fetch_snapshots WHERE id = 'snap-test'")
        self.conn.rollback()

        self.conn.execute(
            """
            INSERT INTO evidence (id, snapshot_id, excerpt, observed_at)
            VALUES ('ev-ok', 'snap-test', 'KVM is offered', '2024-01-15T00:00:00Z')
            """
        )
        self.conn.execute(
            """
            INSERT INTO claims (
              id, subject_type, subject_id, claim_type, value,
              knowledge_state, assessment_state, observed_at
            ) VALUES (
              'claim-ok', 'provider', 'legacy-local', 'hypervisor', '{"text":"KVM"}'::jsonb,
              'present', 'extracted', '2024-01-15T00:00:00Z'
            )
            """
        )
        self.conn.execute(
            """
            INSERT INTO claim_evidence (claim_id, evidence_id, stance)
            VALUES ('claim-ok', 'ev-ok', 'supports')
            """
        )
        self.conn.commit()

        with self.assertRaises(Exception):
            self.conn.execute(
                """
                INSERT INTO evidence (id, snapshot_id, excerpt)
                VALUES ('ev-bad', 'snap-test', 'SOC 2 Type II certified')
                """
            )
        self.conn.rollback()


class TestLegacyDataMigrationCli(unittest.TestCase):
    def test_requires_explicit_database_url(self):
        with self.assertRaises(SystemExit):
            legacy.main([])
        src = (ROOT / "scripts" / "migrate_legacy_data.py").read_text()
        self.assertNotIn("/home/hermes-prime", src)
        self.assertNotIn("os.environ.get(\"DATABASE_URL\")", src)
        self.assertNotIn("os.environ['DATABASE_URL']", src)


class TestLegacyDataMigrationSkipContract(unittest.TestCase):
    def test_skip_reason_names_test_database_url(self):
        self.assertIn("TEST_DATABASE_URL", SKIP_REASON)
        self.assertTrue(SKIP_REASON.startswith("TEST_DATABASE_URL not set") or TEST_DATABASE_URL)
