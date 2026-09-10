"""Focused L7 current-claim resolver; isolated schema on the disposable DB only."""
import os
import unittest
import uuid
from pathlib import Path
import psycopg

NOW = "2026-09-10T12:00:00Z"
CLAIMS_DDL = """
CREATE TABLE claims (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  claim_type TEXT NOT NULL,
  value JSONB,
  knowledge_state TEXT NOT NULL,
  assessment_state TEXT NOT NULL,
  observed_at TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ NOT NULL,
  valid_from TIMESTAMPTZ,
  valid_to TIMESTAMPTZ,
  superseded_by TEXT
)
"""


@unittest.skipUnless(os.environ.get("TEST_DATABASE_URL"), "disposable TEST_DATABASE_URL required")
class CurrentClaimsL7(unittest.TestCase):
    def test_resolver_chain_cycle_temporal_tiebreak_and_conflict(self):
        with psycopg.connect(os.environ["TEST_DATABASE_URL"]) as conn:
            schema = "l7_" + uuid.uuid4().hex
            conn.execute(f"CREATE SCHEMA {schema}")
            conn.execute(f"SET LOCAL search_path TO {schema}, public")
            conn.execute(CLAIMS_DDL)
            conn.execute(Path("migrations/0015_current_claims.sql").read_text())

            def insert(cid, value, *, claim_type="hypervisor", knowledge="present", assessment="extracted",
                       observed="2026-06-01T00:00:00Z", recorded="2026-01-01T00:00:00Z",
                       valid_from=None, valid_to=None, superseded_by=None):
                conn.execute(
                    """INSERT INTO claims (
                         id, subject_type, subject_id, claim_type, value, knowledge_state, assessment_state,
                         observed_at, recorded_at, valid_from, valid_to, superseded_by
                       ) VALUES (%s,'provider','local-packages',%s,%s::jsonb,%s,%s,%s,%s,%s,%s,%s)""",
                    (cid, claim_type, value, knowledge, assessment, observed, recorded, valid_from, valid_to, superseded_by),
                )

            def current(claim_type="hypervisor"):
                return conn.execute(
                    """SELECT id, value, knowledge_state, assessment_state, contributing_ids
                       FROM current_claims_at(%s)
                       WHERE subject_type='provider' AND subject_id='local-packages' AND claim_type=%s""",
                    (NOW, claim_type),
                ).fetchall()

            insert("rejected", '{"text":"no"}', assessment="rejected", observed="2026-09-01T00:00:00Z", recorded="2020-01-01T00:00:00Z")
            insert("expired", '{"text":"old"}', observed="2026-08-01T00:00:00Z", recorded="2020-02-01T00:00:00Z", valid_to="2026-09-01T00:00:00Z")
            insert("future", '{"text":"later"}', observed="2026-09-09T00:00:00Z", recorded="2020-03-01T00:00:00Z", valid_from="2026-12-01T00:00:00Z")
            insert("valid", '{"text":"KVM"}', observed="2026-05-01T00:00:00Z", recorded="2026-09-09T00:00:00Z")
            rows = current()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0][0], "valid")
            self.assertEqual(rows[0][1]["text"], "KVM")

            conn.execute("DELETE FROM claims")
            insert("head", '{"text":"KVM"}', assessment="independently_verified", observed="2026-01-01T00:00:00Z", recorded="2022-01-01T00:00:00Z")
            insert("middle", '{"text":"ESXi"}', observed="2025-01-01T00:00:00Z", recorded="2021-01-01T00:00:00Z", superseded_by="head")
            insert("first-recorded", '{"text":"Xen"}', observed="2024-01-01T00:00:00Z", recorded="2020-01-01T00:00:00Z", superseded_by="middle")
            rows = current()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0][0], "head")
            self.assertEqual(rows[0][1]["text"], "KVM")
            self.assertEqual(rows[0][3], "independently_verified")
            self.assertNotEqual(rows[0][0], "first-recorded")

            conn.execute("DELETE FROM claims")
            insert("cycle-a", '{"text":"A"}', recorded="2020-01-01T00:00:00Z", superseded_by="cycle-b")
            insert("cycle-b", '{"text":"B"}', recorded="2021-01-01T00:00:00Z", superseded_by="cycle-a")
            self.assertEqual(current(), [])
            insert("dangling", '{"text":"ghost"}', recorded="2020-01-01T00:00:00Z", superseded_by="missing-claim")
            insert("ok", '{"text":"KVM"}', recorded="2026-01-01T00:00:00Z")
            rows = current()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0][0], "ok")

            conn.execute("DELETE FROM claims")
            insert("on-from", '{"text":"from"}', valid_from=NOW, recorded="2026-09-10T11:00:00Z")
            insert("on-to", '{"text":"to"}', claim_type="orchestration", valid_to=NOW, recorded="2026-09-10T11:00:00Z")
            insert("before-from", '{"text":"early"}', claim_type="storage", valid_from="2026-09-10T12:00:00.001Z")
            insert("after-to", '{"text":"late"}', claim_type="control_plane", valid_to="2026-09-10T11:59:59.999Z")
            self.assertEqual([row[0] for row in current("hypervisor")], ["on-from"])
            self.assertEqual([row[0] for row in current("orchestration")], ["on-to"])
            self.assertEqual(current("storage"), [])
            self.assertEqual(current("control_plane"), [])

            conn.execute("DELETE FROM claims")
            insert("claim-a", '{"text":"KVM"}', assessment="independently_verified", observed="2026-06-01T00:00:00Z", recorded="2020-01-01T00:00:00Z")
            insert("claim-z", '{"text":"KVM"}', assessment="independently_verified", observed="2026-06-01T00:00:00Z", recorded="2026-09-01T00:00:00Z")
            rows = current()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0][0], "claim-z")
            self.assertNotEqual(rows[0][0], "claim-a")

            conn.execute("DELETE FROM claims")
            insert("verified", '{"text":"KVM"}', assessment="independently_verified", observed="2025-01-01T00:00:00Z", recorded="2025-01-02T00:00:00Z")
            insert("extracted-later", '{"text":"Xen"}', assessment="extracted", observed="2026-08-01T00:00:00Z", recorded="2026-08-02T00:00:00Z")
            rows = current()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0][0], "verified")
            self.assertEqual(rows[0][3], "independently_verified")

            conn.execute("DELETE FROM claims")
            insert("src-kvm", '{"text":"KVM"}', assessment="independently_verified", observed="2026-04-01T00:00:00Z", recorded="2026-04-02T00:00:00Z")
            insert("src-xen", '{"text":"Xen"}', assessment="independently_verified", observed="2026-05-01T00:00:00Z", recorded="2026-05-02T00:00:00Z")
            rows = current()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0][2], "conflicting")
            self.assertIsNone(rows[0][1])
            self.assertEqual(rows[0][3], "independently_verified")
            self.assertEqual(rows[0][0], "src-xen")
            self.assertEqual(sorted(rows[0][4]), ["src-kvm", "src-xen"])
            conn.rollback()
