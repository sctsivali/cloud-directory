"""PostgreSQL collection pipeline. Skip when TEST_DATABASE_URL is absent."""
from __future__ import annotations

import os
import unittest
from datetime import datetime, timezone
from pathlib import Path

from tests.helpers import ROOT, load_script
from workers.collector.fetch import HttpResponse, MockDnsResolver, MockHttpTransport
from workers.mcp_submit import McpProposalClient, TestOnlyInMemoryMcpTransport
from workers.orchestrator import run_collection_task
from workers.store import PgCollectionStore

migrate = load_script("migrate")

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "").strip()
SKIP_REASON = (
    "TEST_DATABASE_URL not set; skipping PostgreSQL collection pipeline tests "
    "(unit collector/extractor tests still run)"
)
PUBLIC_IP = "93.184.216.34"
URL = "https://fixtures.example.test/page"
FIXTURES = ROOT / "tests" / "fixtures" / "sources"


class FrozenClock:
    def __init__(self, value: datetime | None = None) -> None:
        self.value = value or datetime(2026, 9, 1, tzinfo=timezone.utc)

    def now(self) -> datetime:
        return self.value


def _connect():
    if not TEST_DATABASE_URL:
        raise unittest.SkipTest(SKIP_REASON)
    try:
        import psycopg
    except ImportError as exc:
        raise unittest.SkipTest("psycopg is not installed; skipping PostgreSQL tests") from exc
    return psycopg.connect(TEST_DATABASE_URL)


@unittest.skipUnless(TEST_DATABASE_URL, SKIP_REASON)
class TestCollectionPipeline(unittest.TestCase):
    def setUp(self):
        self.conn = _connect()
        self.conn.execute("DROP SCHEMA IF EXISTS public CASCADE")
        self.conn.execute("CREATE SCHEMA public")
        self.conn.commit()
        migrate.apply_migrations(TEST_DATABASE_URL)

    def tearDown(self):
        try:
            self.conn.close()
        except Exception:
            pass

    def _run(self, key: str, filename: str, provider_id: str = "local-packages"):
        body = (FIXTURES / filename).read_bytes()
        store = PgCollectionStore(self.conn)
        self.mcp_transport = TestOnlyInMemoryMcpTransport(principal_id="collector-worker")
        client = McpProposalClient(self.mcp_transport)
        return run_collection_task(
            source_url=URL,
            idempotency_key=key,
            provider_id=provider_id,
            resolver=MockDnsResolver({"fixtures.example.test": [PUBLIC_IP]}),
            transport=MockHttpTransport({URL: HttpResponse(200, {"Content-Type": "text/html"}, body)}),
            store=store,
            proposals=client,
            clock=FrozenClock(),
        )

    def test_pipeline_writes_receipts_and_proposals_not_public_tables(self):
        result = self._run("pg-ok", "ok-200.html")
        self.assertEqual(result.fetch_state, "ok")
        self.assertIsNotNone(result.snapshot_id)
        self.assertGreater(len(result.proposal_ids), 0)
        providers = self.conn.execute("SELECT count(*) FROM providers").fetchone()[0]
        tiers = self.conn.execute("SELECT count(*) FROM tiers").fetchone()[0]
        updates = self.conn.execute("SELECT count(*) FROM directory_updates").fetchone()[0]
        claims = self.conn.execute("SELECT count(*) FROM claims").fetchone()[0]
        proposals = self.conn.execute("SELECT count(*) FROM proposals").fetchone()[0]
        revisions = self.conn.execute("SELECT count(*) FROM revisions").fetchone()[0]
        reviews = self.conn.execute("SELECT count(*) FROM proposal_reviews").fetchone()[0]
        tasks = self.conn.execute("SELECT count(*) FROM collection_tasks").fetchone()[0]
        runs = self.conn.execute("SELECT count(*) FROM model_runs").fetchone()[0]
        snaps = self.conn.execute("SELECT count(*) FROM fetch_snapshots").fetchone()[0]
        self.assertEqual(providers, 0)
        self.assertEqual(tiers, 0)
        self.assertEqual(updates, 0)
        self.assertEqual(claims, 0)
        self.assertEqual(proposals, 0)
        self.assertEqual(revisions, 0)
        self.assertEqual(reviews, 0)
        self.assertGreater(len(self.mcp_transport.rows), 0)
        self.assertTrue(all(row["status"] == "pending_review" for row in self.mcp_transport.rows.values()))
        self.assertTrue(all(call["name"].startswith("directory.propose_") for call in self.mcp_transport.calls))
        self.assertTrue(
            all("actorId" not in call["arguments"] and "actor_id" not in call["arguments"] for call in self.mcp_transport.calls)
        )
        self.assertEqual(tasks, 1)
        self.assertGreater(runs, 0)
        self.assertEqual(snaps, 1)
        fetched = self.conn.execute("SELECT fetched_at FROM collection_tasks").fetchone()[0]
        self.conn.execute(
            "UPDATE collection_tasks SET updated_at = now() WHERE idempotency_key = %s",
            ("pg-ok",),
        )
        self.conn.commit()
        fetched_again = self.conn.execute("SELECT fetched_at FROM collection_tasks").fetchone()[0]
        self.assertEqual(fetched, fetched_again)

    def test_fetched_at_cannot_be_rewritten(self):
        self._run("pg-immut", "ok-200.html")
        with self.assertRaises(Exception):
            self.conn.execute(
                "UPDATE collection_tasks SET fetched_at = now() WHERE idempotency_key = %s",
                ("pg-immut",),
            )
        self.conn.rollback()

    def test_model_runs_are_immutable(self):
        self._run("pg-run", "ok-200.html")
        run_id = self.conn.execute("SELECT id FROM model_runs LIMIT 1").fetchone()[0]
        with self.assertRaises(Exception):
            self.conn.execute("UPDATE model_runs SET model_name = 'tamper' WHERE id = %s", (run_id,))
        self.conn.rollback()

    def test_replay_json_does_not_change_freshness(self):
        first = self._run("pg-fresh", "stale-evidence.html", provider_id="stale-rack")
        first_fetched = first.fetched_at
        second = self._run("pg-fresh", "stale-evidence.html", provider_id="stale-rack")
        self.assertEqual(second.fetched_at, first_fetched)
        count = self.conn.execute("SELECT count(*) FROM fetch_snapshots").fetchone()[0]
        self.assertEqual(count, 1)

    def test_prompt_injection_page_proposes_confirmed_absent_kvm(self):
        result = self._run("pg-inject", "prompt-injection.html", provider_id="kvm-negated")
        bodies = [row["body"] for row in self.mcp_transport.rows.values() if row["idempotency_key"].startswith("pg-inject:claim:hypervisor:")]
        self.assertTrue(bodies, result.proposal_ids)
        knowledge = {row.get("knowledgeState") for row in bodies}
        self.assertIn("confirmed_absent", knowledge)
        self.assertNotIn("independently_verified", {row.get("assessmentState") for row in bodies})
