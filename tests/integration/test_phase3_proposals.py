"""Schema 6 proposal ledger constraints. Skip when TEST_DATABASE_URL is absent."""
from __future__ import annotations

import os
import unittest

from tests.helpers import load_script

migrate = load_script("migrate")

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "").strip()
SKIP_REASON = (
    "TEST_DATABASE_URL not set; skipping PostgreSQL Phase 3 proposal tests "
    "(pure parser/manifest tests still run)"
)


def _connect():
    if not TEST_DATABASE_URL:
        raise unittest.SkipTest(SKIP_REASON)
    try:
        import psycopg
    except ImportError as exc:
        raise unittest.SkipTest("psycopg is not installed; skipping PostgreSQL tests") from exc
    return psycopg.connect(TEST_DATABASE_URL)


@unittest.skipUnless(TEST_DATABASE_URL, SKIP_REASON)
class TestPhase3ProposalSchema(unittest.TestCase):
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

    def test_same_key_cannot_store_two_bodies(self):
        self.conn.execute(
            """
            INSERT INTO proposals (id, tool_name, actor_id, idempotency_key, body, body_digest, status)
            VALUES (
              'p1', 'directory.propose_claim', 'worker-a', 'key-1',
              '{"claimType":"hypervisor"}'::jsonb,
              %s, 'pending_review'
            )
            """,
            ("a" * 64,),
        )
        self.conn.commit()
        with self.assertRaises(Exception):
            self.conn.execute(
                """
                INSERT INTO proposals (id, tool_name, actor_id, idempotency_key, body, body_digest, status)
                VALUES (
                  'p2', 'directory.propose_claim', 'worker-a', 'key-1',
                  '{"claimType":"storage"}'::jsonb,
                  %s, 'pending_review'
                )
                """,
                ("b" * 64,),
            )
        self.conn.rollback()
        count = self.conn.execute("SELECT count(*) FROM proposals").fetchone()[0]
        self.assertEqual(count, 1)

    def test_database_rejects_self_approval(self):
        self.conn.execute(
            """
            INSERT INTO proposals (id, tool_name, actor_id, idempotency_key, body, body_digest, status)
            VALUES (
              'p-self', 'directory.propose_claim', 'worker-a', 'key-self',
              '{"claimType":"hypervisor"}'::jsonb,
              %s, 'pending_review'
            )
            """,
            ("c" * 64,),
        )
        self.conn.commit()
        with self.assertRaises(Exception) as ctx:
            self.conn.execute(
                """
                INSERT INTO proposal_reviews (id, proposal_id, reviewer_id, decision)
                VALUES ('r1', 'p-self', 'worker-a', 'approve')
                """
            )
        self.assertIn("self-approve", str(ctx.exception).lower())
        self.conn.rollback()
        reviews = self.conn.execute("SELECT count(*) FROM proposal_reviews").fetchone()[0]
        self.assertEqual(reviews, 0)

    def _insert_proposal(self, proposal_id: str, actor_id: str, key: str) -> None:
        self.conn.execute(
            """
            INSERT INTO proposals (id, tool_name, actor_id, idempotency_key, body, body_digest, status)
            VALUES (
              %s, 'directory.propose_claim', %s, %s,
              '{"claimType":"hypervisor"}'::jsonb,
              %s, 'pending_review'
            )
            """,
            (proposal_id, actor_id, key, "d" * 64),
        )
        self.conn.commit()

    def test_schema_rejects_non_canonical_principal_ids(self):
        variants = (
            "Worker-A",
            "WORKER-A",
            "worker-A",
            " worker-a",
            "worker-a ",
            " worker-a ",
            "worker a",
            "",
            "1worker",
            "worker/a",
        )
        columns = (
            (
                "proposals.actor_id",
                """
                INSERT INTO proposals (id, tool_name, actor_id, idempotency_key, body, body_digest, status)
                VALUES (
                  'p-bad-actor', 'directory.propose_claim', %s, 'key-bad-actor',
                  '{"claimType":"hypervisor"}'::jsonb, %s, 'pending_review'
                )
                """,
                ("e" * 64,),
            ),
        )
        for label, sql, extra in columns:
            for value in variants:
                with self.subTest(column=label, value=value):
                    with self.assertRaises(Exception):
                        self.conn.execute(sql, (value, *extra))
                    self.conn.rollback()
        count = self.conn.execute("SELECT count(*) FROM proposals").fetchone()[0]
        self.assertEqual(count, 0)

        self._insert_proposal("p-canon", "worker-a", "key-canon")
        for value in variants:
            with self.subTest(column="revisions.actor_id", value=value):
                with self.assertRaises(Exception):
                    self.conn.execute(
                        """
                        INSERT INTO revisions (
                          id, proposal_id, revision_ordinal, body, body_digest, actor_id
                        ) VALUES ('rev-bad', 'p-canon', 1, '{"x":1}'::jsonb, %s, %s)
                        """,
                        ("f" * 64, value),
                    )
                self.conn.rollback()
            with self.subTest(column="proposal_reviews.reviewer_id", value=value):
                with self.assertRaises(Exception):
                    self.conn.execute(
                        """
                        INSERT INTO proposal_reviews (id, proposal_id, reviewer_id, decision)
                        VALUES ('revw-bad', 'p-canon', %s, 'reject')
                        """,
                        (value,),
                    )
                self.conn.rollback()

    def test_schema_rejects_self_approval_case_and_whitespace_variants(self):
        self._insert_proposal("p-self-var", "worker-a", "key-self-var")
        variants = (
            "worker-a",
            "Worker-A",
            "WORKER-A",
            "worker-A",
            " worker-a",
            "worker-a ",
            " worker-a ",
        )
        for reviewer_id in variants:
            with self.subTest(reviewer_id=reviewer_id):
                with self.assertRaises(Exception) as ctx:
                    self.conn.execute(
                        """
                        INSERT INTO proposal_reviews (id, proposal_id, reviewer_id, decision)
                        VALUES (%s, 'p-self-var', %s, 'approve')
                        """,
                        (f"r-{reviewer_id!r}", reviewer_id),
                    )
                message = str(ctx.exception).lower()
                self.assertTrue(
                    "self-approve" in message or "check" in message or "actor_id" in message
                    or "reviewer_id" in message or "violat" in message,
                    message,
                )
                self.conn.rollback()
        reviews = self.conn.execute("SELECT count(*) FROM proposal_reviews").fetchone()[0]
        self.assertEqual(reviews, 0)
        self.conn.execute(
            """
            INSERT INTO proposal_reviews (id, proposal_id, reviewer_id, decision)
            VALUES ('r-ok', 'p-self-var', 'editor-1', 'approve')
            """
        )
        self.conn.commit()
        stored = self.conn.execute(
            "SELECT reviewer_id FROM proposal_reviews WHERE id = 'r-ok'"
        ).fetchone()[0]
        self.assertEqual(stored, "editor-1")
