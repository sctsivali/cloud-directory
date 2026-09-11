"""Independent verification lane. AI disagreement is conflict, not majority truth."""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

NEGATION_RE = re.compile(
    r"\b(do not|don't|does not|we do not|no longer|not use|not offer|without)\b.{0,40}\b(KVM|kvm)\b"
    r"|\b(KVM|kvm)\b.{0,40}\b(is not used|not supported|not offered)\b",
    re.I,
)
HEDGE_RE = re.compile(
    r"\b(may|might|possibly|likely|probably|appears to|typically)\b.{0,40}\b(KVM|kvm)\b",
    re.I,
)

OFFICE_RE = re.compile(r"\b(sales office|head office|corporate office|office address)\b", re.I)
DEFAULT_FRESHNESS_DAYS = 365


class VerificationError(ValueError):
    """Verification failed closed."""


@dataclass(frozen=True)
class VerificationRequest:
    excerpt: str
    snapshot_body: str
    subject_id: str
    evidence_subject_id: str
    claim_type: str
    claim_value: str
    knowledge_state: str
    assessment_state: str
    fetched_at: str
    recorded_at: str
    now: str
    source_authority: str
    evidence_kind: str
    claimed_scope: str
    freshness_max_age_days: int = DEFAULT_FRESHNESS_DAYS
    peer_knowledge_states: tuple[str, ...] = ()


@dataclass(frozen=True)
class VerificationResult:
    accepted: bool
    knowledge_state: str
    assessment_state: str
    review_required: bool
    reasons: tuple[str, ...]


def _parse_iso(value: str) -> datetime:
    text = value.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError as exc:
        raise VerificationError("timestamp is malformed") from exc
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def excerpt_exists(excerpt: str, snapshot_body: str) -> bool:
    return bool(excerpt) and excerpt.strip() != "" and excerpt in snapshot_body


def is_stale(fetched_at: str, now: str, max_age_days: int) -> bool:
    fetched = _parse_iso(fetched_at)
    current = _parse_iso(now)
    return current - fetched > timedelta(days=max_age_days)


def _negated_kvm(excerpt: str) -> bool:
    return bool(NEGATION_RE.search(excerpt))


def _hedged_kvm(excerpt: str) -> bool:
    return bool(HEDGE_RE.search(excerpt))


def verify_claim(request: VerificationRequest) -> VerificationResult:
    reasons: list[str] = []

    if not excerpt_exists(request.excerpt, request.snapshot_body):
        return VerificationResult(
            accepted=False,
            knowledge_state="unknown",
            assessment_state="rejected",
            review_required=True,
            reasons=("exact excerpt missing from snapshot",),
        )

    if request.subject_id != request.evidence_subject_id:
        return VerificationResult(
            accepted=False,
            knowledge_state="unknown",
            assessment_state="rejected",
            review_required=True,
            reasons=("assertion subject does not match evidence subject",),
        )

    knowledge = request.knowledge_state
    assessment = request.assessment_state
    review = False

    if request.claim_type in {"hypervisor", "technology"} and request.claim_value.upper() == "KVM":
        if _negated_kvm(request.excerpt):
            if knowledge == "present":
                reasons.append("negated KVM cannot be present")
                return VerificationResult(
                    accepted=False,
                    knowledge_state="confirmed_absent",
                    assessment_state="rejected",
                    review_required=True,
                    reasons=tuple(reasons),
                )
            knowledge = "confirmed_absent"
        elif _hedged_kvm(request.excerpt):
            review = True
            reasons.append("hedged statement cannot be independently verified")
            if assessment == "independently_verified":
                assessment = "extracted"
            knowledge = "present"
        elif "KVM" not in request.excerpt and "kvm" not in request.excerpt.lower():
            return VerificationResult(
                accepted=False,
                knowledge_state="unknown",
                assessment_state="rejected",
                review_required=True,
                reasons=("excerpt does not mention the claimed technology",),
            )

    if request.claimed_scope == "facility_exact" and (
        request.evidence_kind == "office_address" or OFFICE_RE.search(request.excerpt)
    ):
        return VerificationResult(
            accepted=False,
            knowledge_state="unknown",
            assessment_state="rejected",
            review_required=True,
            reasons=("office address is not a data-centre facility",),
        )

    if request.source_authority != "official" and assessment == "independently_verified":
        review = True
        assessment = "extracted"
        reasons.append("non-official source cannot independently verify")

    if is_stale(request.fetched_at, request.now, request.freshness_max_age_days):
        reasons.append("stale evidence cannot be presented as current")
        if assessment == "independently_verified":
            assessment = "extracted"
        review = True
        return VerificationResult(
            accepted=False,
            knowledge_state=knowledge,
            assessment_state="rejected",
            review_required=True,
            reasons=tuple(reasons),
        )

    unique_peers = {state for state in request.peer_knowledge_states if state}
    unique_peers.add(knowledge)
    if len(unique_peers) > 1:
        return VerificationResult(
            accepted=False,
            knowledge_state="conflicting",
            assessment_state="extracted",
            review_required=True,
            reasons=("ai disagreement is conflicting/needs_review, not majority truth",),
        )

    if assessment == "independently_verified" and (review or knowledge in {"unknown", "conflicting"}):
        return VerificationResult(
            accepted=False,
            knowledge_state=knowledge,
            assessment_state="rejected",
            review_required=True,
            reasons=tuple(reasons) or ("independently_verified is not justified",),
        )

    accepted = not review and assessment in {"extracted", "provider_asserted", "independently_verified"}
    if review:
        assessment = "extracted"
    return VerificationResult(
        accepted=accepted,
        knowledge_state=knowledge,
        assessment_state=assessment,
        review_required=review,
        reasons=tuple(reasons),
    )
