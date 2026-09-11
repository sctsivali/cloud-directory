"""Durable collection submission outcomes. Ambiguous is terminal and never auto-retried."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Mapping

from workers.canonical import body_digest, proposal_body_for_digest

SUBMISSION_OUTCOMES = frozenset({"created", "replayed", "rejected", "ambiguous"})
MAX_SUBMISSION_REASON_CODES = 16
MAX_REQUIRED_SUBMISSIONS = 64
SUBMISSION_REASON_CODE_RE = r"^[a-z][a-z0-9_]{0,63}$"
SUBMISSION_REASON_CODES = (
    "excerpt_missing",
    "subject_mismatch",
    "negated_kvm",
    "hedged_statement",
    "excerpt_mismatch",
    "office_not_facility",
    "non_official_source",
    "stale_evidence",
    "ai_disagreement",
    "independently_verified_unjustified",
    "malformed_payload",
    "idempotency_conflict",
    "tool_unavailable",
    "commit_uncertain",
    "digest_conflict",
    "mcp_rejected",
)
_REASON_SET = frozenset(SUBMISSION_REASON_CODES)

VERIFIER_REASON_MAP = {
    "exact excerpt missing from snapshot": "excerpt_missing",
    "assertion subject does not match evidence subject": "subject_mismatch",
    "negated KVM cannot be present": "negated_kvm",
    "hedged statement cannot be independently verified": "hedged_statement",
    "excerpt does not mention the claimed technology": "excerpt_mismatch",
    "office address is not a data-centre facility": "office_not_facility",
    "non-official source cannot independently verify": "non_official_source",
    "stale evidence cannot be presented as current": "stale_evidence",
    "ai disagreement is conflicting/needs_review, not majority truth": "ai_disagreement",
    "independently_verified is not justified": "independently_verified_unjustified",
}
MCP_CODE_MAP = {
    "malformed_payload": "malformed_payload",
    "idempotency_conflict": "idempotency_conflict",
    "tool_unavailable": "tool_unavailable",
    "commit_uncertain": "commit_uncertain",
    "digest_conflict": "digest_conflict",
}


class SubmissionError(ValueError):
    """Submission outcome failed closed."""


@dataclass(frozen=True)
class SubmissionOutcome:
    id: str
    task_id: str
    tool_name: str
    idempotency_key: str
    request_digest: str
    outcome: str
    proposal_id: str | None
    reason_codes: tuple[str, ...]
    created_at: str


def bound_reason_codes(codes: Iterable[str]) -> tuple[str, ...]:
    items = list(codes)
    if len(items) > MAX_SUBMISSION_REASON_CODES:
        raise ValueError("reason code out of bounds")
    out: list[str] = []
    for code in items:
        if code not in _REASON_SET:
            raise ValueError("reason code out of bounds")
        if code not in out:
            out.append(code)
    return tuple(out)


def reason_codes_from_verifier_reasons(reasons: Iterable[str]) -> tuple[str, ...]:
    mapped = [VERIFIER_REASON_MAP.get(reason, "mcp_rejected") for reason in reasons]
    return bound_reason_codes(mapped[:MAX_SUBMISSION_REASON_CODES])


def reason_codes_from_mcp(code: str | None) -> tuple[str, ...]:
    if not code:
        return ()
    return bound_reason_codes((MCP_CODE_MAP.get(code, "mcp_rejected"),))


def merge_reason_codes(*groups: Iterable[str]) -> tuple[str, ...]:
    merged: list[str] = []
    for group in groups:
        for code in group:
            if code not in merged:
                merged.append(code)
    return bound_reason_codes(merged)


def request_digest_for(tool_name: str, payload: Mapping[str, Any]) -> str:
    return body_digest(proposal_body_for_digest(tool_name, dict(payload)))


def is_ambiguous_terminal(outcome: str) -> bool:
    return outcome == "ambiguous"


def should_auto_retry_submission(existing: Any | None) -> bool:
    return existing is None


def submission_identity_matches(
    existing: Any,
    *,
    task_id: str,
    tool_name: str,
    idempotency_key: str,
    request_digest: str,
) -> bool:
    return (
        existing.task_id == task_id
        and existing.tool_name == tool_name
        and existing.idempotency_key == idempotency_key
        and existing.request_digest == request_digest
    )


def require_submission_identity(
    existing: Any | None,
    *,
    task_id: str,
    tool_name: str,
    idempotency_key: str,
    request_digest: str,
) -> Any | None:
    if existing is None:
        return None
    if not submission_identity_matches(
        existing,
        task_id=task_id,
        tool_name=tool_name,
        idempotency_key=idempotency_key,
        request_digest=request_digest,
    ):
        raise SubmissionError("idempotency identity collision")
    return existing


def bound_required_submission_count(count: int) -> int:
    if not isinstance(count, int) or isinstance(count, bool) or count < 0 or count > MAX_REQUIRED_SUBMISSIONS:
        raise ValueError("required_submission_count out of bounds")
    return count


def resolve_collection_task_status(required: Iterable[Mapping[str, str] | Any], required_count: int) -> str:
    if not isinstance(required_count, int) or isinstance(required_count, bool) or required_count < 1 or required_count > MAX_REQUIRED_SUBMISSIONS:
        return "failed"
    rows = list(required)
    outcomes: list[str] = []
    keys: list[str] = []
    for row in rows:
        if isinstance(row, Mapping):
            outcomes.append(str(row["outcome"]))
            keys.append(str(row["idempotency_key"]))
        else:
            outcomes.append(str(getattr(row, "outcome")))
            keys.append(str(getattr(row, "idempotency_key")))
    if any(outcome == "ambiguous" for outcome in outcomes):
        return "ambiguous"
    if any(outcome == "rejected" for outcome in outcomes):
        return "failed"
    if (
        len(rows) == required_count
        and len(set(keys)) == required_count
        and all(outcome in {"created", "replayed"} for outcome in outcomes)
    ):
        return "proposed"
    return "failed"
