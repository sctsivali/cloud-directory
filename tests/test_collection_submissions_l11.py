"""L11 durable worker submissions: outcomes, gates, crash/retry, reason bounds."""
from __future__ import annotations

import unittest
from datetime import datetime, timezone

from workers.collector.fetch import HttpResponse, MockDnsResolver, MockHttpTransport
from workers.mcp_submit import McpProposalClient, TestOnlyInMemoryMcpTransport
from workers.orchestrator import _submit_required, run_collection_task
from workers.store import MemoryCollectionStore, StoreError
from workers.submissions import (
    MAX_SUBMISSION_REASON_CODES,
    SubmissionError,
    SubmissionOutcome,
    bound_reason_codes,
    is_ambiguous_terminal,
    reason_codes_from_verifier_reasons,
    require_submission_identity,
    resolve_collection_task_status,
    should_auto_retry_submission,
)
from workers.orchestrator import _submit_required

PUBLIC_IP = "93.184.216.34"
URL = "https://fixtures.example.test/page"
OK_BODY = b"""<!DOCTYPE html><html><body>
<h1>Nusantara Compute</h1>
<p>Legal entity: PT Fixture Nusantara Digital, Indonesia.</p>
<p>Primary data centre: Nusantara DC Campus, Jakarta, Indonesia.</p>
<p>Hypervisor: KVM. Control plane: Proxmox.</p>
<p>Compute S USD 8.50 / month</p>
</body></html>
"""


class FrozenClock:
    def __init__(self, value: datetime | None = None) -> None:
        self.value = value or datetime(2026, 9, 1, tzinfo=timezone.utc)

    def now(self) -> datetime:
        return self.value


def _dns() -> MockDnsResolver:
    return MockDnsResolver({"fixtures.example.test": [PUBLIC_IP]})


def _transport(body: bytes = OK_BODY, status: int = 200) -> MockHttpTransport:
    return MockHttpTransport({URL: HttpResponse(status, {"Content-Type": "text/html; charset=utf-8"}, body)})


class ForcedOutcomeTransport(TestOnlyInMemoryMcpTransport):
    def __init__(self, outcome: str, *, principal_id: str = "collector-worker") -> None:
        super().__init__(principal_id=principal_id)
        self.forced_outcome = outcome

    def call_tool(self, name: str, arguments: dict) -> dict:
        if self.forced_outcome == "rejected":
            payload = dict(arguments)
            self.calls.append({"name": name, "arguments": payload})
            return {
                "outcome": "rejected",
                "code": "malformed_payload",
                "message": "forced reject",
            }
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


class MixedOutcomeTransport(TestOnlyInMemoryMcpTransport):
    def call_tool(self, name: str, arguments: dict) -> dict:
        if len(self.calls) >= 1:
            payload = dict(arguments)
            self.calls.append({"name": name, "arguments": payload})
            return {
                "outcome": "rejected",
                "code": "malformed_payload",
                "message": "later required submission rejected",
            }
        return super().call_tool(name, arguments)


def _run(store, client, key="k-l11"):
    return run_collection_task(
        source_url=URL,
        idempotency_key=key,
        provider_id="local-packages",
        resolver=_dns(),
        transport=_transport(),
        store=store,
        proposals=client,
        clock=FrozenClock(),
    )


class TestSubmissionDomainRules(unittest.TestCase):
    def test_ambiguous_is_terminal_and_never_auto_retried(self):
        self.assertTrue(is_ambiguous_terminal("ambiguous"))
        self.assertFalse(is_ambiguous_terminal("rejected"))
        self.assertTrue(should_auto_retry_submission(None))
        self.assertFalse(should_auto_retry_submission(type("O", (), {"outcome": "ambiguous"})()))
        self.assertFalse(should_auto_retry_submission(type("O", (), {"outcome": "created"})()))

    def test_all_required_created_or_replayed_is_proposed(self):
        self.assertEqual(
            resolve_collection_task_status(
                [
                    {"idempotency_key": "a", "outcome": "created"},
                    {"idempotency_key": "b", "outcome": "replayed"},
                ],
                2,
            ),
            "proposed",
        )
        self.assertEqual(resolve_collection_task_status([], 0), "failed")
        self.assertEqual(
            resolve_collection_task_status([{"idempotency_key": "a", "outcome": "created"}], 2),
            "failed",
        )

    def test_rejected_required_is_failed_not_proposed(self):
        self.assertEqual(
            resolve_collection_task_status(
                [
                    {"idempotency_key": "a", "outcome": "created"},
                    {"idempotency_key": "b", "outcome": "rejected"},
                ],
                2,
            ),
            "failed",
        )

    def test_ambiguous_required_is_needs_review_or_ambiguous(self):
        status = resolve_collection_task_status(
            [
                {"idempotency_key": "a", "outcome": "created"},
                {"idempotency_key": "b", "outcome": "ambiguous"},
            ],
            2,
        )
        self.assertIn(status, {"needs_review", "ambiguous"})
        self.assertNotEqual(status, "proposed")

    def test_reason_codes_are_bounded(self):
        self.assertEqual(
            bound_reason_codes(["excerpt_missing", "commit_uncertain"]),
            ("excerpt_missing", "commit_uncertain"),
        )
        with self.assertRaises(ValueError):
            bound_reason_codes(["NOT_A_CODE"])
        with self.assertRaises(ValueError):
            bound_reason_codes(["nope"])
        with self.assertRaises(ValueError):
            bound_reason_codes(["mcp_rejected"] * (MAX_SUBMISSION_REASON_CODES + 1))

    def test_verifier_reasons_map_to_bounded_codes(self):
        codes = reason_codes_from_verifier_reasons(
            (
                "exact excerpt missing from snapshot",
                "stale evidence cannot be presented as current",
            )
        )
        self.assertEqual(codes, ("excerpt_missing", "stale_evidence"))
        bound_reason_codes(codes)


class TestWorkerSubmissionOutcomes(unittest.TestCase):
    def test_created_outcomes_are_appended_and_task_is_proposed(self):
        store = MemoryCollectionStore()
        transport = TestOnlyInMemoryMcpTransport(principal_id="collector-worker")
        result = _run(store, McpProposalClient(transport), "k-created")
        task = store.get_task_by_key("k-created")
        assert task is not None
        outcomes = store.list_submission_outcomes(task.id)
        self.assertGreater(len(outcomes), 0)
        self.assertTrue(all(row.outcome == "created" for row in outcomes))
        self.assertEqual(task.status, "proposed")
        self.assertEqual(result.status, "proposed")
        self.assertTrue(all(row.proposal_id for row in outcomes))
        self.assertTrue(all(len(row.request_digest) == 64 for row in outcomes))
        self.assertEqual(task.required_submission_count, len(outcomes))
        claim_rows = [row for row in transport.rows.values() if row["tool_name"] == "directory.propose_claim"]
        self.assertTrue(claim_rows)
        for row in claim_rows:
            value = row["body"].get("value") or {}
            self.assertIn("verifierReasons", value)
            self.assertIn("reasonCodes", value)

    def test_replayed_after_crash_before_outcome_persist(self):
        store = MemoryCollectionStore()
        transport = TestOnlyInMemoryMcpTransport(principal_id="collector-worker")
        client = McpProposalClient(transport)
        store.fail_next_outcome_writes = 1
        with self.assertRaises(StoreError):
            _run(store, client, "k-crash-replay")
        self.assertGreater(len(transport.rows), 0)
        task = store.get_task_by_key("k-crash-replay")
        assert task is not None
        self.assertNotEqual(task.status, "proposed")
        store.fail_next_outcome_writes = 0
        again = _run(store, client, "k-crash-replay")
        outcomes = store.list_submission_outcomes(task.id)
        self.assertTrue(any(row.outcome == "replayed" for row in outcomes))
        self.assertEqual(again.status, "proposed")
        self.assertEqual(store.get_task_by_key("k-crash-replay").status, "proposed")

    def test_rejected_required_submission_prevents_proposed(self):
        store = MemoryCollectionStore()
        transport = ForcedOutcomeTransport("rejected")
        result = _run(store, McpProposalClient(transport), "k-rejected")
        task = store.get_task_by_key("k-rejected")
        assert task is not None
        outcomes = store.list_submission_outcomes(task.id)
        self.assertTrue(outcomes)
        self.assertTrue(all(row.outcome == "rejected" for row in outcomes))
        self.assertEqual(task.status, "failed")
        self.assertEqual(result.status, "failed")
        self.assertNotEqual(task.status, "proposed")
        self.assertTrue(any("malformed_payload" in row.reason_codes for row in outcomes))

    def test_ambiguous_required_submission_is_terminal_and_never_retried(self):
        store = MemoryCollectionStore()
        transport = ForcedOutcomeTransport("ambiguous")
        first = _run(store, McpProposalClient(transport), "k-ambiguous")
        task = store.get_task_by_key("k-ambiguous")
        assert task is not None
        outcomes = store.list_submission_outcomes(task.id)
        self.assertTrue(outcomes)
        self.assertTrue(all(row.outcome == "ambiguous" for row in outcomes))
        self.assertIn(task.status, {"needs_review", "ambiguous"})
        self.assertEqual(first.status, task.status)
        self.assertNotEqual(task.status, "proposed")
        calls_after_first = len(transport.calls)
        second = _run(store, McpProposalClient(transport), "k-ambiguous")
        self.assertEqual(len(transport.calls), calls_after_first)
        self.assertEqual(second.status, task.status)
        self.assertEqual(len(store.list_submission_outcomes(task.id)), len(outcomes))
        self.assertEqual(len(transport.rows), 0)

    def test_all_required_gate_rejects_mixed_created_and_rejected(self):
        store = MemoryCollectionStore()
        transport = MixedOutcomeTransport(principal_id="collector-worker")
        result = _run(store, McpProposalClient(transport), "k-mixed")
        task = store.get_task_by_key("k-mixed")
        assert task is not None
        outcomes = store.list_submission_outcomes(task.id)
        kinds = {row.outcome for row in outcomes}
        self.assertIn("created", kinds)
        self.assertIn("rejected", kinds)
        self.assertEqual(task.status, "failed")
        self.assertEqual(result.status, "failed")

    def test_durable_outcome_is_principal_safe_and_digest_stable(self):
        store = MemoryCollectionStore()
        transport = TestOnlyInMemoryMcpTransport(principal_id="collector-worker")
        _run(store, McpProposalClient(transport), "k-digest")
        task = store.get_task_by_key("k-digest")
        assert task is not None
        for row in store.list_submission_outcomes(task.id):
            self.assertFalse(hasattr(row, "actor_id"))
            self.assertNotIn("actorId", row.__dict__)
            self.assertRegex(row.request_digest, r"^[0-9a-f]{64}$")
        for call in transport.calls:
            self.assertNotIn("actorId", call["arguments"])
            self.assertNotIn("actor_id", call["arguments"])

    def test_identity_collision_fails_closed_in_memory(self):
        store = MemoryCollectionStore()
        transport = TestOnlyInMemoryMcpTransport(principal_id="collector-worker")
        _run(store, McpProposalClient(transport), "k-ident")
        task = store.get_task_by_key("k-ident")
        assert task is not None
        row = store.list_submission_outcomes(task.id)[0]
        colliding = SubmissionOutcome(
            id="cso-collide",
            task_id="task-other",
            tool_name=row.tool_name,
            idempotency_key=row.idempotency_key,
            request_digest=row.request_digest,
            outcome="created",
            proposal_id=row.proposal_id,
            reason_codes=(),
            created_at=row.created_at,
        )
        with self.assertRaises((StoreError, SubmissionError)):
            store.record_submission_outcome(colliding)
        with self.assertRaises((StoreError, SubmissionError)):
            store.record_submission_outcome(
                SubmissionOutcome(
                    id="cso-tool",
                    task_id=row.task_id,
                    tool_name="directory.propose_facility",
                    idempotency_key=row.idempotency_key,
                    request_digest=row.request_digest,
                    outcome="created",
                    proposal_id=row.proposal_id,
                    reason_codes=(),
                    created_at=row.created_at,
                )
            )
        with self.assertRaises((StoreError, SubmissionError)):
            store.record_submission_outcome(
                SubmissionOutcome(
                    id="cso-digest",
                    task_id=row.task_id,
                    tool_name=row.tool_name,
                    idempotency_key=row.idempotency_key,
                    request_digest="a" * 64,
                    outcome="created",
                    proposal_id=row.proposal_id,
                    reason_codes=(),
                    created_at=row.created_at,
                )
            )
        replayed = store.record_submission_outcome(
            SubmissionOutcome(
                id="cso-same",
                task_id=row.task_id,
                tool_name=row.tool_name,
                idempotency_key=row.idempotency_key,
                request_digest=row.request_digest,
                outcome="replayed",
                proposal_id=row.proposal_id,
                reason_codes=(),
                created_at=row.created_at,
            )
        )
        self.assertEqual(replayed.id, row.id)
        with self.assertRaises(SubmissionError):
            require_submission_identity(
                row,
                task_id="task-other",
                tool_name=row.tool_name,
                idempotency_key=row.idempotency_key,
                request_digest=row.request_digest,
            )
        with self.assertRaises((StoreError, SubmissionError)):
            _submit_required(
                store=store,
                task=type("T", (), {"id": "task-other"})(),
                proposals=McpProposalClient(transport),
                tool_name=row.tool_name,
                payload={"marker": "collision"},
                idempotency_key=row.idempotency_key,
                reason_codes=(),
                required=[],
                proposal_ids=[],
                now=datetime(2026, 9, 1, tzinfo=timezone.utc),
            )
        with self.assertRaises(StoreError):
            store.set_required_submission_count(task, (task.required_submission_count or 0) + 1, datetime(2026, 9, 1, tzinfo=timezone.utc))
