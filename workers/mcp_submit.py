"""Transport-level MCP proposal client. Workers never write proposal tables."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Protocol
from uuid import uuid4

from workers.canonical import body_digest, proposal_body_for_digest

PROPOSAL_TOOLS = frozenset(
    {
        "directory.propose_claim",
        "directory.propose_offering",
        "directory.propose_price_observation",
        "directory.propose_location",
        "directory.propose_facility",
        "directory.propose_technology_deployment",
        "directory.propose_retraction",
    }
)
PUBLICATION_TOOLS = frozenset(
    {
        "directory.publish_revision",
        "directory.publish_change",
    }
)
FORBIDDEN_TOOL_NAMES = frozenset(
    {
        "sql.query",
        "sql.execute",
        "directory.execute_sql",
        "directory.mutate",
        "directory.update_fields",
        "directory.arbitrary_mutation",
    }
)
IDENTITY_FIELDS = frozenset({"actorId", "reviewerId", "actor_id", "reviewer_id"})
PRINCIPAL_RE = r"^[a-z][a-z0-9_-]{0,63}$"


class ProposalSubmitError(ValueError):
    """Submission failed closed before any canonical write."""


@dataclass(frozen=True)
class SubmitResult:
    outcome: str
    proposal_id: str | None
    code: str | None = None
    message: str | None = None


class McpTransport(Protocol):
    """Message transport to an MCP server. Principal identity is server configuration."""

    def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        ...


class LiveStdioMcpTransport:
    """Intentionally unavailable. Production tests inject TestOnlyInMemoryMcpTransport."""

    def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        raise RuntimeError("live MCP transport is disabled")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _reject_identity(payload: dict[str, Any]) -> None:
    present = sorted(field for field in IDENTITY_FIELDS if field in payload)
    if present:
        raise ProposalSubmitError("model-supplied identity fields are rejected")


def _result_from_mcp(raw: Any) -> SubmitResult:
    if not isinstance(raw, dict):
        raise ProposalSubmitError("mcp transport returned a non-object")
    outcome = str(raw.get("outcome") or "")
    proposal = raw.get("proposal") if isinstance(raw.get("proposal"), dict) else {}
    proposal_id = proposal.get("id") or raw.get("proposalId") or raw.get("proposal_id")
    code = raw.get("code")
    message = raw.get("message")
    if outcome in {"created", "replayed"}:
        return SubmitResult(
            outcome=outcome,
            proposal_id=str(proposal_id) if proposal_id else None,
        )
    if outcome in {"rejected", "ambiguous"}:
        return SubmitResult(
            outcome=outcome,
            proposal_id=str(proposal_id) if proposal_id else None,
            code=str(code) if code else None,
            message=str(message) if message else None,
        )
    raise ProposalSubmitError(f"unrecognized mcp outcome: {outcome}")


class McpProposalClient:
    """Worker MCP client. Invokes directory.propose_* only. Never sends actor identity."""

    def __init__(self, transport: McpTransport) -> None:
        self._transport = transport

    def invoke(
        self,
        tool_name: str,
        payload: dict[str, Any],
        *,
        idempotency_key: str,
    ) -> SubmitResult:
        if tool_name in PUBLICATION_TOOLS or tool_name in FORBIDDEN_TOOL_NAMES:
            raise ProposalSubmitError("publication and SQL tools are unavailable")
        if tool_name not in PROPOSAL_TOOLS:
            raise ProposalSubmitError(f"unknown proposal tool: {tool_name}")
        if not isinstance(payload, dict):
            raise ProposalSubmitError("proposal payload must be an object")
        _reject_identity(payload)
        if not str(idempotency_key or "").strip():
            raise ProposalSubmitError("idempotency_key is required")
        arguments = dict(payload)
        arguments["idempotencyKey"] = idempotency_key
        _reject_identity(arguments)
        return _result_from_mcp(self._transport.call_tool(tool_name, arguments))


class TestOnlyInMemoryMcpTransport:
    """TEST-ONLY fake MCP server.

    Principal identity is constructor configuration (MCP_PRINCIPAL_ID analogue),
    never a client/worker/model payload field. Not a production publication path.
    """

    __test__ = False

    def __init__(self, *, principal_id: str = "collector-worker") -> None:
        import re

        if not re.fullmatch(PRINCIPAL_RE, principal_id or ""):
            raise ProposalSubmitError("principal_id is not a canonical principal")
        self.principal_id = principal_id
        self.calls: list[dict[str, Any]] = []
        self.rows: dict[str, dict[str, Any]] = {}
        self.by_id: dict[str, dict[str, Any]] = {}

    def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        payload = dict(arguments)
        self.calls.append({"name": name, "arguments": payload})
        if name in PUBLICATION_TOOLS or name in FORBIDDEN_TOOL_NAMES:
            return {
                "outcome": "rejected",
                "code": "tool_unavailable",
                "message": "publication and SQL tools are unavailable",
            }
        if name not in PROPOSAL_TOOLS:
            return {
                "outcome": "rejected",
                "code": "tool_unavailable",
                "message": f"unknown proposal tool: {name}",
            }
        identity = sorted(field for field in IDENTITY_FIELDS if field in payload)
        if identity:
            return {
                "outcome": "rejected",
                "code": "malformed_payload",
                "message": "model-supplied identity fields are rejected",
            }
        idempotency_key = str(payload.get("idempotencyKey") or "")
        if not idempotency_key.strip():
            return {
                "outcome": "rejected",
                "code": "malformed_payload",
                "message": "idempotencyKey is required",
            }
        digest = body_digest(proposal_body_for_digest(name, payload))
        existing = self.rows.get(idempotency_key)
        if existing is not None:
            if existing["body_digest"] != digest:
                return {
                    "outcome": "rejected",
                    "code": "idempotency_conflict",
                    "message": "same idempotency key with a different body",
                    "proposal": {"id": existing["id"], "actorId": existing["actor_id"]},
                }
            return {
                "outcome": "replayed",
                "proposal": {
                    "id": existing["id"],
                    "actorId": existing["actor_id"],
                    "status": existing["status"],
                    "toolName": existing["tool_name"],
                },
            }
        proposal_id = "prop-" + uuid4().hex
        row = {
            "id": proposal_id,
            "tool_name": name,
            "actor_id": self.principal_id,
            "idempotency_key": idempotency_key,
            "body": {k: v for k, v in payload.items() if k != "idempotencyKey"},
            "body_digest": digest,
            "status": "pending_review",
            "created_at": _now_iso(),
        }
        self.rows[idempotency_key] = row
        self.by_id[proposal_id] = row
        return {
            "outcome": "created",
            "proposal": {
                "id": proposal_id,
                "actorId": self.principal_id,
                "status": "pending_review",
                "toolName": name,
            },
        }
