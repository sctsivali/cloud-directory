"""PostgreSQL L11 collection_submission_outcomes. Skip when TEST_DATABASE_URL is absent."""
from __future__ import annotations

import os
import unittest
from datetime import datetime, timezone

from tests.helpers import ROOT, load_script
from workers.collector.fetch import HttpResponse, MockDnsResolver, MockHttpTransport
from workers.mcp_submit import McpProposalClient, TestOnlyInMemoryMcpTransport
from workers.orchestrator import run_collection_task
from workers.store import PgCollectionStore, StoreError
from workers.submissions import MAX_SUBMISSION_REASON_CODES

migrate = load_script("migrate")

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "").strip()
SKIP_REASON = "TEST_DATABASE_URL not set; skipping PostgreSQL L11 tests"
PUBLIC_IP = "93.184.216.34"
URL = "https://fixtures.example.test/page"
OK_BODY = b"""<!DOCTYPE html><html><body>
<h1>Nusantara Compute</h1>
<p>Primary data centre: Nusantara DC Campus, Jakarta, Indonesia.</p>
<p>Hypervisor: KVM.</p>
<p>Compute S USD 8.50 / month</p>
</body></html>
"""


class FrozenClock:
    def __init__(self) -> None:
        self.value = datetime(2026, 9, 1, tzinfo=timezone.utc)

    def now(self) -> datetime:
        return self.value


class ForcedOutcomeTransport(TestOnlyInMemoryMcpTransport):
    def __init__(self, outcome: str, *, principal_id: str = "collector-worker") -> None:
        super().__init__(principal_id=principal_id)
        self.forced_outcome = outcome

    def call_tool(self, name: str, arguments: dict) -> dict:
        if self.forced_outcome == "rejected":
            payload = dict(arguments)
            self.calls.append({"name": name, "arguments": payload})
            return {"outcome": "rejected", "code": "malformed_payload", "message": "forced reject"}
        if self.forced_outcome == "ambiguous":
            payload = dict(arguments)
            self.calls.append({"name": name, "arguments": payload})
            return {
                "outcome": "ambiguous",
                "code": "commit_uncertain",
                "message": "commit was not confirmed",
                "idempotencyKey": payload.get("idempotencyKey"),
            }
        return super().call_tool(name, arguments)


def _connect():
    if not TEST_DATABASE_URL:
        raise unittest.SkipTest(SKIP_REASON)
    try:
        import psycopg
    except ImportError as exc:
        raise unittest.SkipTest("psycopg is not installed; skipping PostgreSQL tests") from exc
    return psycopg.connect(TEST_DATABASE_URL)


@unittest.skipUnless(TEST_DATABASE_URL, SKIP_REASON)
class TestCollectionSubmissionOutcomesPg(unittest.TestCase):
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

    def _run(self, key: str, transport=None):
        store = PgCollectionStore(self.conn)
        mcp = transport or TestOnlyInMemoryMcpTransport(principal_id="collector-worker")
        client = McpProposalClient(mcp)
        result = run_collection_task(
            source_url=URL,
            idempotency_key=key,
            provider_id="local-packages",
            resolver=MockDnsResolver({"fixtures.example.test": [PUBLIC_IP]}),
            transport=MockHttpTransport({URL: HttpResponse(200, {"Content-Type": "text/html"}, OK_BODY)}),
            store=store,
            proposals=client,
            clock=FrozenClock(),
        )
        return result, store, mcp

    def test_created_rows_are_append_only_and_task_is_proposed(self):
        result, store, mcp = self._run("pg-created")
        self.assertEqual(result.status, "proposed")
        count = self.conn.execute("SELECT count(*) FROM collection_submission_outcomes").fetchone()[0]
        self.assertGreater(count, 0)
        statuses = self.conn.execute("SELECT status FROM collection_tasks").fetchall()
        self.assertEqual(statuses[0][0], "proposed")
        outcomes = self.conn.execute(
            "SELECT outcome, request_digest, proposal_id FROM collection_submission_outcomes"
        ).fetchall()
        self.assertTrue(all(row[0] == "created" for row in outcomes))
        self.assertTrue(all(len(row[1]) == 64 for row in outcomes))
        self.assertTrue(all(row[2] for row in outcomes))
        row_id = self.conn.execute("SELECT id FROM collection_submission_outcomes LIMIT 1").fetchone()[0]
        with self.assertRaises(Exception):
            self.conn.execute(
                "UPDATE collection_submission_outcomes SET outcome = 'rejected' WHERE id = %s",
                (row_id,),
            )
        self.conn.rollback()
        with self.assertRaises(Exception):
            self.conn.execute("DELETE FROM collection_submission_outcomes WHERE id = %s", (row_id,))
        self.conn.rollback()
        claim_bodies = [row["body"] for row in mcp.rows.values() if row["tool_name"] == "directory.propose_claim"]
        self.assertTrue(any("verifierReasons" in (body.get("value") or {}) for body in claim_bodies))

    def test_rejected_and_ambiguous_cannot_become_proposed(self):
        rejected, _, _ = self._run("pg-rejected", ForcedOutcomeTransport("rejected"))
        self.assertEqual(rejected.status, "failed")
        self.assertEqual(
            self.conn.execute("SELECT status FROM collection_tasks WHERE idempotency_key = %s", ("pg-rejected",)).fetchone()[0],
            "failed",
        )
        with self.assertRaises(Exception):
            self.conn.execute(
                "UPDATE collection_tasks SET status = 'proposed' WHERE idempotency_key = %s",
                ("pg-rejected",),
            )
        self.conn.rollback()

        ambiguous, _, mcp = self._run("pg-ambiguous", ForcedOutcomeTransport("ambiguous"))
        self.assertIn(ambiguous.status, {"needs_review", "ambiguous"})
        status = self.conn.execute(
            "SELECT status FROM collection_tasks WHERE idempotency_key = %s",
            ("pg-ambiguous",),
        ).fetchone()[0]
        self.assertIn(status, {"needs_review", "ambiguous"})
        self.assertNotEqual(status, "proposed")
        calls = len(mcp.calls)
        again, _, mcp2 = self._run("pg-ambiguous", mcp)
        self.assertEqual(len(mcp.calls), calls)
        self.assertEqual(again.status, status)
        self.assertEqual(len(mcp2.rows), 0)

    def test_reason_code_bounds_and_unique_idempotency(self):
        self._run("pg-bounds")
        task_id = self.conn.execute("SELECT id FROM collection_tasks").fetchone()[0]
        too_many = ["mcp_rejected"] * (MAX_SUBMISSION_REASON_CODES + 1)
        with self.assertRaises(Exception):
            self.conn.execute(
                """
                INSERT INTO collection_submission_outcomes (
                  id, task_id, tool_name, idempotency_key, request_digest, outcome, reason_codes
                ) VALUES (%s,%s,'directory.propose_claim',%s, %s, 'rejected', %s)
                """,
                ("cso-too-many", task_id, "pg-bounds:extra-many", "a" * 64, too_many),
            )
        self.conn.rollback()
        with self.assertRaises(Exception):
            self.conn.execute(
                """
                INSERT INTO collection_submission_outcomes (
                  id, task_id, tool_name, idempotency_key, request_digest, outcome, reason_codes
                ) VALUES (%s,%s,'directory.propose_claim',%s, %s, 'rejected', %s)
                """,
                ("cso-bad-code", task_id, "pg-bounds:extra-bad", "b" * 64, ["NOT_A_CODE"]),
            )
        self.conn.rollback()
        existing_key = self.conn.execute(
            "SELECT idempotency_key FROM collection_submission_outcomes LIMIT 1"
        ).fetchone()[0]
        with self.assertRaises(Exception):
            self.conn.execute(
                """
                INSERT INTO collection_submission_outcomes (
                  id, task_id, tool_name, idempotency_key, request_digest, outcome, reason_codes
                ) VALUES (%s,%s,'directory.propose_claim',%s, %s, 'replayed', '{}')
                """,
                ("cso-dup", task_id, existing_key, "c" * 64),
            )
        self.conn.rollback()

    def test_crash_retry_records_replayed_then_proposed(self):
        store = PgCollectionStore(self.conn)
        store.fail_next_outcome_writes = 1
        mcp = TestOnlyInMemoryMcpTransport(principal_id="collector-worker")
        client = McpProposalClient(mcp)
        with self.assertRaises(StoreError):
            run_collection_task(
                source_url=URL,
                idempotency_key="pg-crash",
                provider_id="local-packages",
                resolver=MockDnsResolver({"fixtures.example.test": [PUBLIC_IP]}),
                transport=MockHttpTransport({URL: HttpResponse(200, {"Content-Type": "text/html"}, OK_BODY)}),
                store=store,
                proposals=client,
                clock=FrozenClock(),
            )
        store.fail_next_outcome_writes = 0
        again = run_collection_task(
            source_url=URL,
            idempotency_key="pg-crash",
            provider_id="local-packages",
            resolver=MockDnsResolver({"fixtures.example.test": [PUBLIC_IP]}),
            transport=MockHttpTransport({URL: HttpResponse(200, {"Content-Type": "text/html"}, OK_BODY)}),
            store=store,
            proposals=client,
            clock=FrozenClock(),
        )
        kinds = {row[0] for row in self.conn.execute("SELECT outcome FROM collection_submission_outcomes").fetchall()}
        self.assertIn("replayed", kinds)
        self.assertEqual(again.status, "proposed")
        self.assertEqual(
            self.conn.execute("SELECT status FROM collection_tasks WHERE idempotency_key = %s", ("pg-crash",)).fetchone()[0],
            "proposed",
        )
