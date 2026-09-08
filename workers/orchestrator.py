"""Fetch → extract → verify → MCP proposal. Never writes public catalog facts."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from workers.collector.fetch import Clock, FetchLimits, FetchReceipt, HttpTransport, UtcClock, fetch_url
from workers.collector.policy import DnsResolver
from workers.extractor.facility import extract_facility
from workers.extractor.offering import extract_offering
from workers.extractor.provider import extract_provider
from workers.extractor.technology import extract_technology
from workers.mcp_submit import McpProposalClient
from workers.pricing.normalize import PriceNormalizationError, normalize_price
from workers.store import (
    CollectionStore,
    StoredModelRun,
    can_retry,
)
from workers.verifier.verify_claim import VerificationRequest, verify_claim

SUCCESS_FETCH_STATES = frozenset({"ok", "redirect"})
WORKER_ACTOR = "collector-worker"
LEASE_TTL = timedelta(minutes=5)


@dataclass
class PipelineResult:
    task_id: str
    fetch_state: str
    snapshot_id: str | None
    fetched_at: str | None
    proposal_ids: list[str] = field(default_factory=list)
    retried: bool = False
    published_canonical: bool = False
    errors: list[str] = field(default_factory=list)


def _now(clock: Clock) -> datetime:
    value = clock.now()
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _iso(now: datetime) -> str:
    return now.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _persist_model_run(store: CollectionStore, task_id: str, extraction, recorded_at: datetime) -> StoredModelRun:
    run = StoredModelRun(
        id="run-" + uuid4().hex,
        collection_task_id=task_id,
        adapter_name=extraction.adapter_name,
        model_provider=extraction.provenance.model_provider,
        model_name=extraction.provenance.model_name,
        ruleset_version=extraction.provenance.ruleset_version,
        input_digest=extraction.provenance.input_digest,
        output_digest=extraction.provenance.output_digest,
        envelope=extraction.envelope,
        output=extraction.output,
        started_at=extraction.provenance.started_at,
        finished_at=extraction.provenance.finished_at,
        recorded_at=_iso(recorded_at),
    )
    return store.save_model_run(run)


def run_collection_task(
    *,
    source_url: str,
    idempotency_key: str,
    provider_id: str,
    resolver: DnsResolver,
    transport: HttpTransport,
    store: CollectionStore,
    proposals: McpProposalClient,
    clock: Clock | None = None,
    limits: FetchLimits | None = None,
    owner: str = WORKER_ACTOR,
    now_override: str | None = None,
    adapters: dict[str, Any] | None = None,
) -> PipelineResult:
    clock = clock or UtcClock()
    now = _now(clock)
    task = store.acquire_lease(
        idempotency_key,
        owner,
        now,
        LEASE_TTL,
        source_url,
        provider_id,
    )
    result = PipelineResult(task_id=task.id, fetch_state=task.fetch_state or "", snapshot_id=task.snapshot_id, fetched_at=task.fetched_at)

    receipt: FetchReceipt | None = None
    if task.snapshot_id:
        stored = store.get_snapshot(task.snapshot_id)
        if stored is None:
            result.errors.append("snapshot missing after crash")
            store.mark_status(task, "failed", now, "snapshot missing")
            result.fetch_state = "malformed"
            return result
        receipt = stored.receipt
        result.snapshot_id = stored.id
        result.fetched_at = task.fetched_at or receipt.fetched_at
        result.fetch_state = receipt.fetch_state
    else:
        receipt = fetch_url(
            source_url,
            resolver=resolver,
            transport=transport,
            clock=clock,
            limits=limits,
        )
        recorded = _now(clock)
        snapshot = store.save_snapshot(receipt, recorded)
        task = store.attach_snapshot(task, snapshot, recorded)
        result.snapshot_id = snapshot.id
        result.fetched_at = task.fetched_at
        result.fetch_state = receipt.fetch_state

        if not can_retry(receipt.fetch_state, receipt.http_status) and receipt.fetch_state not in SUCCESS_FETCH_STATES:
            store.mark_status(task, "failed", recorded, receipt.fetch_state)
            return result
        if can_retry(receipt.fetch_state, receipt.http_status):
            store.mark_status(task, "failed", recorded, "timeout")
            result.retried = False
            result.errors.append("timeout is retryable only before an HTTP status is observed")
            return result

    assert receipt is not None
    if receipt.fetch_state not in SUCCESS_FETCH_STATES:
        store.mark_status(task, "failed", _now(clock), receipt.fetch_state)
        return result

    subject = {"provider_id": provider_id}
    adapter_map = adapters or {}
    recorded = _now(clock)
    provider_ex = extract_provider(receipt, subject, adapter_map.get("provider"))
    offering_ex = extract_offering(receipt, subject, adapter_map.get("offering"))
    facility_ex = extract_facility(receipt, subject, adapter_map.get("facility"))
    technology_ex = extract_technology(receipt, subject, adapter_map.get("technology"))
    for extraction in (provider_ex, offering_ex, facility_ex, technology_ex):
        _persist_model_run(store, task.id, extraction, recorded)
    store.mark_status(task, "extracted", recorded)

    current_now = now_override or _iso(_now(clock))
    proposal_ids: list[str] = []

    for tech in technology_ex.output.get("technologies") or []:
        verification = verify_claim(
            VerificationRequest(
                excerpt=str(tech.get("excerpt") or ""),
                snapshot_body=receipt.body,
                subject_id=provider_id,
                evidence_subject_id=provider_id,
                claim_type="hypervisor",
                claim_value=str(tech.get("name") or ""),
                knowledge_state=str(tech.get("knowledge_state") or "unknown"),
                assessment_state="extracted",
                fetched_at=receipt.fetched_at,
                recorded_at=_iso(recorded),
                now=current_now,
                source_authority="official",
                evidence_kind="provider_page",
                claimed_scope=str(tech.get("scope") or "provider"),
            )
        )
        if verification.assessment_state == "rejected" and not verification.review_required:
            result.errors.extend(verification.reasons)
            continue
        if verification.knowledge_state == "conflicting" or verification.review_required:
            knowledge = verification.knowledge_state
            assessment = "extracted"
        else:
            knowledge = verification.knowledge_state
            assessment = "extracted"
        submitted = proposals.invoke(
            "directory.propose_claim",
            {
                "subjectType": "provider",
                "subjectId": provider_id,
                "claimType": "hypervisor",
                "value": {"text": tech.get("name"), "hedged": tech.get("hedged")},
                "knowledgeState": knowledge,
                "assessmentState": assessment,
                "observedAt": receipt.fetched_at,
                "snapshotId": result.snapshot_id,
                "excerpt": tech.get("excerpt"),
            },
            idempotency_key=f"{idempotency_key}:claim:hypervisor:{tech.get('name')}",
        )
        if submitted.proposal_id:
            proposal_ids.append(submitted.proposal_id)

    for fac in facility_ex.output.get("facilities") or []:
        kind = fac.get("kind")
        precision = fac.get("map_precision") or "undisclosed"
        evidence_kind = "office_address" if kind == "office" else "facility_identity"
        verification = verify_claim(
            VerificationRequest(
                excerpt=str(fac.get("excerpt") or fac.get("address") or fac.get("name") or " "),
                snapshot_body=receipt.body,
                subject_id=provider_id,
                evidence_subject_id=provider_id,
                claim_type="facility",
                claim_value=str(fac.get("name") or kind or ""),
                knowledge_state="present",
                assessment_state="extracted",
                fetched_at=receipt.fetched_at,
                recorded_at=_iso(recorded),
                now=current_now,
                source_authority="official",
                evidence_kind=evidence_kind,
                claimed_scope=str(precision),
            )
        )
        if verification.assessment_state == "rejected":
            result.errors.extend(verification.reasons)
            continue
        submitted = proposals.invoke(
            "directory.propose_facility",
            {
                "name": fac.get("name") or kind or "undisclosed",
                "mapPrecision": precision if precision != "facility_exact" or kind == "datacenter" else "undisclosed",
                "address": fac.get("address") or "",
                "operator": "",
            },
            idempotency_key=f"{idempotency_key}:facility:{fac.get('kind')}:{fac.get('name')}",
        )
        if submitted.proposal_id:
            proposal_ids.append(submitted.proposal_id)

    for off in offering_ex.output.get("offerings") or []:
        try:
            normalized = normalize_price(
                amount=off.get("amount"),
                currency=off.get("currency"),
                billing_unit=off.get("billing_unit"),
                commitment=off.get("commitment") or "none",
                promo=bool(off.get("promo")),
                renewal="same_as_list",
                tax="unknown",
                region=provider_id,
                source=receipt.final_url,
            )
        except PriceNormalizationError as exc:
            result.errors.append(str(exc))
            continue
        submitted = proposals.invoke(
            "directory.propose_price_observation",
            {
                "offeringId": f"{provider_id}:{off.get('name')}",
                "amount": float(normalized.amount),
                "currency": normalized.currency,
                "billingUnit": normalized.billing_unit,
                "observedAt": receipt.fetched_at,
                "commitment": normalized.commitment,
                "promo": normalized.promo,
            },
            idempotency_key=f"{idempotency_key}:price:{off.get('name')}:{normalized.currency}",
        )
        if submitted.proposal_id:
            proposal_ids.append(submitted.proposal_id)

    if provider_ex.output.get("provider_name"):
        submitted = proposals.invoke(
            "directory.propose_claim",
            {
                "subjectType": "provider",
                "subjectId": provider_id,
                "claimType": "provider_name",
                "value": {"text": provider_ex.output.get("provider_name")},
                "knowledgeState": "present",
                "assessmentState": "extracted",
                "observedAt": receipt.fetched_at,
                "snapshotId": result.snapshot_id,
            },
            idempotency_key=f"{idempotency_key}:claim:provider_name",
        )
        if submitted.proposal_id:
            proposal_ids.append(submitted.proposal_id)

    store.mark_status(task, "proposed", _now(clock))
    result.proposal_ids = proposal_ids
    result.published_canonical = False
    return result


def retry_timeout_only(
    previous: PipelineResult,
    fetch_state: str,
    http_status: int | None,
) -> bool:
    if previous.fetch_state in SUCCESS_FETCH_STATES:
        return False
    return can_retry(fetch_state, http_status)
