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
from workers.submissions import (
    SubmissionOutcome,
    merge_reason_codes,
    reason_codes_from_mcp,
    reason_codes_from_verifier_reasons,
    request_digest_for,
    require_submission_identity,
    resolve_collection_task_status,
    should_auto_retry_submission,
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
    status: str = ""


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


def _submit_required(
    *,
    store: CollectionStore,
    task,
    proposals: McpProposalClient,
    tool_name: str,
    payload: dict[str, Any],
    idempotency_key: str,
    reason_codes: tuple[str, ...],
    required: list[SubmissionOutcome],
    proposal_ids: list[str],
    now: datetime,
) -> SubmissionOutcome:
    digest = request_digest_for(tool_name, payload)
    existing = store.get_submission_outcome(idempotency_key)
    if existing is not None:
        require_submission_identity(
            existing,
            task_id=task.id,
            tool_name=tool_name,
            idempotency_key=idempotency_key,
            request_digest=digest,
        )
        if not should_auto_retry_submission(existing):
            required.append(existing)
            if existing.proposal_id and existing.outcome in {"created", "replayed"}:
                proposal_ids.append(existing.proposal_id)
            return existing
    if tool_name == "directory.propose_claim":
        submitted = proposals.invoke("directory.propose_claim", payload, idempotency_key=idempotency_key)
    elif tool_name == "directory.propose_facility":
        submitted = proposals.invoke("directory.propose_facility", payload, idempotency_key=idempotency_key)
    elif tool_name == "directory.propose_price_observation":
        submitted = proposals.invoke(
            "directory.propose_price_observation", payload, idempotency_key=idempotency_key
        )
    elif tool_name == "directory.propose_offering":
        submitted = proposals.invoke("directory.propose_offering", payload, idempotency_key=idempotency_key)
    elif tool_name == "directory.propose_location":
        submitted = proposals.invoke("directory.propose_location", payload, idempotency_key=idempotency_key)
    elif tool_name == "directory.propose_technology_deployment":
        submitted = proposals.invoke(
            "directory.propose_technology_deployment", payload, idempotency_key=idempotency_key
        )
    elif tool_name == "directory.propose_retraction":
        submitted = proposals.invoke("directory.propose_retraction", payload, idempotency_key=idempotency_key)
    else:
        raise ValueError(f"unknown proposal tool: {tool_name}")
    codes = merge_reason_codes(reason_codes, reason_codes_from_mcp(submitted.code))
    recorded = store.record_submission_outcome(
        SubmissionOutcome(
            id="cso-" + uuid4().hex,
            task_id=task.id,
            tool_name=tool_name,
            idempotency_key=idempotency_key,
            request_digest=digest,
            outcome=submitted.outcome,
            proposal_id=submitted.proposal_id,
            reason_codes=codes,
            created_at=_iso(now),
        )
    )
    required.append(recorded)
    if recorded.proposal_id and recorded.outcome in {"created", "replayed"}:
        proposal_ids.append(recorded.proposal_id)
    return recorded


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
    required: list[SubmissionOutcome] = []
    pending: list[dict[str, Any]] = []
    submit_now = _now(clock)

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
        reason_codes = reason_codes_from_verifier_reasons(verification.reasons)
        pending.append(
            {
                "tool_name": "directory.propose_claim",
                "payload": {
                    "subjectType": "provider",
                    "subjectId": provider_id,
                    "claimType": "hypervisor",
                    "value": {
                        "text": tech.get("name"),
                        "hedged": tech.get("hedged"),
                        "verifierReasons": list(verification.reasons),
                        "reasonCodes": list(reason_codes),
                    },
                    "knowledgeState": knowledge,
                    "assessmentState": assessment,
                    "observedAt": receipt.fetched_at,
                    "snapshotId": result.snapshot_id,
                    "excerpt": tech.get("excerpt"),
                },
                "idempotency_key": f"{idempotency_key}:claim:hypervisor:{tech.get('name')}",
                "reason_codes": reason_codes,
            }
        )

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
        pending.append(
            {
                "tool_name": "directory.propose_facility",
                "payload": {
                    "name": fac.get("name") or kind or "undisclosed",
                    "mapPrecision": precision if precision != "facility_exact" or kind == "datacenter" else "undisclosed",
                    "address": fac.get("address") or "",
                    "operator": "",
                },
                "idempotency_key": f"{idempotency_key}:facility:{fac.get('kind')}:{fac.get('name')}",
                "reason_codes": reason_codes_from_verifier_reasons(verification.reasons),
            }
        )

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
        pending.append(
            {
                "tool_name": "directory.propose_price_observation",
                "payload": {
                    "offeringId": f"{provider_id}:{off.get('name')}",
                    "amount": float(normalized.amount),
                    "currency": normalized.currency,
                    "billingUnit": normalized.billing_unit,
                    "observedAt": receipt.fetched_at,
                    "commitment": normalized.commitment,
                    "promo": normalized.promo,
                },
                "idempotency_key": f"{idempotency_key}:price:{off.get('name')}:{normalized.currency}",
                "reason_codes": (),
            }
        )

    if provider_ex.output.get("provider_name"):
        pending.append(
            {
                "tool_name": "directory.propose_claim",
                "payload": {
                    "subjectType": "provider",
                    "subjectId": provider_id,
                    "claimType": "provider_name",
                    "value": {
                        "text": provider_ex.output.get("provider_name"),
                        "verifierReasons": [],
                        "reasonCodes": [],
                    },
                    "knowledgeState": "present",
                    "assessmentState": "extracted",
                    "observedAt": receipt.fetched_at,
                    "snapshotId": result.snapshot_id,
                },
                "idempotency_key": f"{idempotency_key}:claim:provider_name",
                "reason_codes": (),
            }
        )

    task = store.set_required_submission_count(task, len(pending), submit_now)
    for item in pending:
        _submit_required(
            store=store,
            task=task,
            proposals=proposals,
            tool_name=item["tool_name"],
            payload=item["payload"],
            idempotency_key=item["idempotency_key"],
            reason_codes=item["reason_codes"],
            required=required,
            proposal_ids=proposal_ids,
            now=submit_now,
        )

    status = resolve_collection_task_status(required, task.required_submission_count or 0)
    error = None
    if status == "failed":
        error = "required submission rejected or incomplete"
    elif status in {"needs_review", "ambiguous"}:
        error = "required submission ambiguous"
    store.mark_status(task, status, _now(clock), error)
    result.proposal_ids = proposal_ids
    result.published_canonical = False
    result.status = status
    return result


def retry_timeout_only(
    previous: PipelineResult,
    fetch_state: str,
    http_status: int | None,
) -> bool:
    if previous.fetch_state in SUCCESS_FETCH_STATES:
        return False
    return can_retry(fetch_state, http_status)
