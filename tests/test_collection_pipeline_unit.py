"""Collection pipeline: crash/replay, idempotency, proposal-only, no canonical publication."""
from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from workers.collector.fetch import FetchLimits, HttpResponse, MockDnsResolver, MockHttpTransport
from workers.mcp_submit import McpProposalClient, TestOnlyInMemoryMcpTransport
from workers.orchestrator import run_collection_task
from workers.store import LeaseHeld, MemoryCollectionStore, can_retry

PUBLIC_IP = "93.184.216.34"
URL = "https://fixtures.example.test/page"


class FrozenClock:
    def __init__(self, value: datetime | None = None) -> None:
        self.value = value or datetime(2026, 9, 1, tzinfo=timezone.utc)

    def now(self) -> datetime:
        return self.value

    def advance(self, **kwargs) -> None:
        self.value = self.value + timedelta(**kwargs)


def _dns() -> MockDnsResolver:
    return MockDnsResolver({"fixtures.example.test": [PUBLIC_IP]})


def _transport(body: bytes, status: int = 200) -> MockHttpTransport:
    return MockHttpTransport({URL: HttpResponse(status, {"Content-Type": "text/html; charset=utf-8"}, body)})


def _proposals() -> tuple[McpProposalClient, TestOnlyInMemoryMcpTransport]:
    transport = TestOnlyInMemoryMcpTransport(principal_id="collector-worker")
    return McpProposalClient(transport), transport


OK_BODY = b"""<!DOCTYPE html><html><body>
<h1>Nusantara Compute</h1>
<p>Legal entity: PT Fixture Nusantara Digital, Indonesia.</p>
<p>Primary data centre: Nusantara DC Campus, Jakarta, Indonesia.</p>
<p>Hypervisor: KVM. Control plane: Proxmox.</p>
<p>Compute S USD 8.50 / month</p>
</body></html>
"""


class TestPipelineIdempotency(unittest.TestCase):
    def test_replay_does_not_change_fetched_at(self):
        store = MemoryCollectionStore()
        client, _sink = _proposals()
        clock = FrozenClock()
        first = run_collection_task(
            source_url=URL,
            idempotency_key="k-replay",
            provider_id="local-packages",
            resolver=_dns(),
            transport=_transport(OK_BODY),
            store=store,
            proposals=client,
            clock=clock,
        )
        self.assertEqual(first.fetch_state, "ok")
        fetched = first.fetched_at
        clock.advance(days=3)
        second = run_collection_task(
            source_url=URL,
            idempotency_key="k-replay",
            provider_id="local-packages",
            resolver=_dns(),
            transport=_transport(b"changed later"),
            store=store,
            proposals=client,
            clock=clock,
        )
        self.assertEqual(second.fetched_at, fetched)
        self.assertEqual(second.snapshot_id, first.snapshot_id)
        snap = store.get_snapshot(first.snapshot_id)
        self.assertIsNotNone(snap)
        assert snap is not None
        self.assertIn("Nusantara", snap.receipt.body)
        self.assertNotIn("changed later", snap.receipt.body)

    def test_same_idempotency_key_replays_proposals(self):
        store = MemoryCollectionStore()
        client, sink = _proposals()
        first = run_collection_task(
            source_url=URL,
            idempotency_key="k-prop",
            provider_id="local-packages",
            resolver=_dns(),
            transport=_transport(OK_BODY),
            store=store,
            proposals=client,
            clock=FrozenClock(),
        )
        second = run_collection_task(
            source_url=URL,
            idempotency_key="k-prop",
            provider_id="local-packages",
            resolver=_dns(),
            transport=_transport(OK_BODY),
            store=store,
            proposals=client,
            clock=FrozenClock(),
        )
        self.assertEqual(first.proposal_ids, second.proposal_ids)
        self.assertGreater(len(first.proposal_ids), 0)
        for row in sink.rows.values():
            self.assertEqual(row["status"], "pending_review")
            self.assertEqual(row["actor_id"], "collector-worker")
        self.assertTrue(all(call["name"].startswith("directory.propose_") for call in sink.calls))
        self.assertTrue(all("actorId" not in call["arguments"] and "actor_id" not in call["arguments"] for call in sink.calls))

    def test_lease_ownership_is_exclusive(self):
        store = MemoryCollectionStore()
        now = datetime(2026, 9, 1, tzinfo=timezone.utc)
        store.acquire_lease("k-lease", "worker-a", now, timedelta(minutes=5), URL, "p1")
        with self.assertRaises(LeaseHeld):
            store.acquire_lease("k-lease", "worker-b", now, timedelta(minutes=5), URL, "p1")

    def test_timeout_is_retryable_only_without_http_status(self):
        self.assertTrue(can_retry("timeout", None))
        self.assertFalse(can_retry("timeout", 200))
        self.assertFalse(can_retry("forbidden", None))
        self.assertFalse(can_retry("ok", 200))
        self.assertFalse(can_retry("redirect", 200))

    def test_403_does_not_emit_verified_prices(self):
        store = MemoryCollectionStore()
        client, sink = _proposals()
        body = b"<html><h1>403 Forbidden</h1><p>USD 1 / month</p></html>"
        result = run_collection_task(
            source_url=URL,
            idempotency_key="k-403",
            provider_id="orbit-grid",
            resolver=_dns(),
            transport=_transport(body, status=403),
            store=store,
            proposals=client,
            clock=FrozenClock(),
        )
        self.assertEqual(result.fetch_state, "forbidden")
        self.assertEqual(result.proposal_ids, [])
        self.assertFalse(result.published_canonical)
        self.assertEqual(sink.calls, [])

    def test_crash_after_snapshot_reattaches_without_refetch(self):
        store = MemoryCollectionStore()
        client, _sink = _proposals()
        clock = FrozenClock()
        first = run_collection_task(
            source_url=URL,
            idempotency_key="k-crash",
            provider_id="local-packages",
            resolver=_dns(),
            transport=_transport(OK_BODY),
            store=store,
            proposals=client,
            clock=clock,
        )
        task = store.get_task_by_key("k-crash")
        assert task is not None
        task.status = "leased"
        task.lease_owner = None
        task.lease_until = None
        store.put_task(task)
        clock.advance(hours=1)
        again = run_collection_task(
            source_url=URL,
            idempotency_key="k-crash",
            provider_id="local-packages",
            resolver=_dns(),
            transport=_transport(b"should not be used"),
            store=store,
            proposals=client,
            clock=clock,
        )
        self.assertEqual(again.snapshot_id, first.snapshot_id)
        self.assertEqual(again.fetched_at, first.fetched_at)

    def test_no_direct_canonical_publication(self):
        store = MemoryCollectionStore()
        client, sink = _proposals()
        result = run_collection_task(
            source_url=URL,
            idempotency_key="k-pub",
            provider_id="local-packages",
            resolver=_dns(),
            transport=_transport(OK_BODY),
            store=store,
            proposals=client,
            clock=FrozenClock(),
            limits=FetchLimits(),
        )
        self.assertFalse(result.published_canonical)
        self.assertTrue(all(row["status"] == "pending_review" for row in sink.rows.values()))
        self.assertTrue(all(row["tool_name"].startswith("directory.propose_") for row in sink.rows.values()))
        self.assertFalse(any("publish" in row["tool_name"] for row in sink.rows.values()))
        self.assertTrue(all(call["name"] in {
            "directory.propose_claim",
            "directory.propose_offering",
            "directory.propose_price_observation",
            "directory.propose_location",
            "directory.propose_facility",
            "directory.propose_technology_deployment",
            "directory.propose_retraction",
        } for call in sink.calls))
