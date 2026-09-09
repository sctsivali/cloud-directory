# MCP contract (Phase 3–7)

Status: Phase 4 workers submit through this same proposal-only contract. Phase 5 points `directory.explain_score` at the shared scoring engine (or a labeled legacy fallback). Phase 6 registers publication tools only for sessions that explicitly include the `publish` capability. Phase 7 adds read-only trend, timeline, and outlook-eligibility tools. Built-in Model Context Protocol server for `guide.cloudin.asia`. AI clients may read the directory and submit typed proposals. Default, read, and propose sessions cannot publish, execute SQL, rewrite canonical facts, or publish forecasts.

## Contract identity

| Field | Value |
|---|---|
| Name | `cloud-directory-mcp` |
| Contract version | `1.3.1` |
| Backing schema version | `11` (`migrations/0011_sod_state_replay.sql`) |
| Transport | stdio (official MCP TypeScript SDK) or in-process for tests |

This contract is separate from the public HTTP API and from any WordPress/editorial MCP.

## Capabilities

Server-side only. A client cannot escalate by declaring extra MCP features.

| Capability | Availability |
|---|---|
| `read` | Available. Discovery includes the read tools below. |
| `collect` | Reserved on MCP. Collection runs in `workers/` with injected DNS/HTTP. Workers submit through a transport-level MCP proposal client. Identity is the server-bound principal (`MCP_PRINCIPAL_ID`), not a worker `actor_id`. |
| `propose` | Available. Typed proposal tools only. |
| `review` | Available. Non-approval review decisions. |
| `approve` | Available. Approval cannot be performed by the proposer. |
| `publish` | **Explicit only.** Publication tools are discovered and invocable solely when the session lists `publish`. Default, read, and propose sessions never see them. Handler-level auth rejects missing `publish` even if dispatch is bypassed. |
| `verify` | **Explicit only.** `directory.verify_publication` is discovered and invocable solely when the session lists `verify`. Publish sessions do not inherit it. The verifier principal must differ from the publisher. |

Discovery lists only tools the session is authorized to use **and** that are available in this phase. Handler-level enforcement rejects hidden names before any tool handler runs.

## Read tools

- `directory.get_provider`
- `directory.search_providers`
- `directory.get_offerings`
- `directory.get_claims`
- `directory.get_evidence`
- `directory.get_source_snapshot`
- `directory.explain_score`
- `directory.get_quality_report`
- `directory.get_trends` (verified revision series; never a forecast)
- `directory.get_timeline` (`providerId` or canonical ISO `country`)
- `directory.get_outlook_eligibility` (gates only; no forecast payload)
- `directory.get_proposal` (status of a durable proposal)

Read tools do not write canonical facts or `/updates`. `explain_score` uses the same offering/deployment engine as Arena, wizard, compare, provider, and methodology. Optional `offeringId` / `deploymentId` select the subject. When no canonical subject exists, the tool returns a payload labeled `legacy-fallback`. Public `/updates` is generated from published `change_events`. Trend series reproduce from verified `publication_receipts` plus methodology/data revision. `directory.get_outlook_eligibility` does not publish forecasts. UI and MCP show **insufficient evidence** when metric gates fail, when the backtest does not pass, or when no observation window can be inferred (empty verified history without a caller window). There is no `directory.publish_forecast` tool.

## Proposal-only mutation tools

Canonical writes are not exposed. These tools persist a proposal row:

- `directory.propose_claim`
- `directory.propose_offering`
- `directory.propose_price_observation`
- `directory.propose_location`
- `directory.propose_facility`
- `directory.propose_technology_deployment`
- `directory.propose_retraction`
- `directory.revise_proposal` (body change; replacement body must match the original tool schema; an approved or rejected proposal returns to review)

There is no generic SQL tool and no arbitrary field-mutation tool. Phase 4 workers invoke these tools over an MCP transport. They do not `INSERT` into `proposals`, `revisions`, or `proposal_reviews`, and they do not send `actorId` / `actor_id` in the tool payload.

## Review tools

- `directory.review_proposal` — `reject` or `request_changes`
- `directory.approve_proposal` — forbidden when the bound `principalId` equals the proposer or the current revision author

Approvals are invalidated when the proposal body changes. An approval is bound to the exact revision id and body digest under a proposal row lock. Published and rejected statuses are terminal except through an authorized revision (back to `pending_review`) or rollback publication. Optional `windowStart` / `windowEnd` on trend, timeline, and outlook tools must be canonical UTC timestamps with `start < end` and a bounded month span; `limit` and `page` are capped.

## Publication tools (explicit publish capability)

Registered only for sessions with `publish`. Direct invocation from read/propose sessions is rejected before handler execution. Handler-level auth also requires `publish`.

- `directory.publish_revision` — publish an approved proposal revision
- `directory.publish_change` — publish a specific approved revision, including rollback/correction
- `directory.verify_publication` — post-public authoritative readback; requires `verify` and a different canonical principal than the publisher

A publication is one serialized atomic transaction with row locks and canonical-state compare-and-set. After `SELECT proposal FOR UPDATE` it re-reads and verifies current proposal status/body digest, the exact revision, the latest valid approval bound to that revision/body, and publisher separation before any canonical/receipt/event write. It binds the exact approved revision and body digest, evidence snapshot IDs, reviewer/approval digest, methodology version, data revision, publisher principal, idempotency key, publication receipt, and verification state. New receipts start at `verification_state=pending`. `directory.verify_publication` atomically transitions `pending` to `verified` when receipt, event, canonical value digest, and data revision match; mismatches are recorded as `failed` or `uncertain` without rewriting published history. The proposal or current revision author cannot publish their own revision. Ambiguous commit outcomes are durable and must be reconciled; they are never blind-retried. Replay, conflict, and uncertain resolvers require a matching request digest, proposal, revision, publisher, and principal before returning a receipt; an identity collision is a rejection, never someone else's replay. `publication_attempts` identities are immutable and states are monotonic: committed/reconciled rows never regress to uncertain. Rollback appends a new approved revision and change event only when the original receipt/event subject equals the rollback target, the current canonical digest equals the original after-value digest, and the supersession chain is valid; it never deletes history.

## Idempotency and outcomes

Proposal tools require `idempotencyKey`. Actor, reviewer, publisher, and revision identity come from a non-model-controlled `principalId` on `ToolContext` / server configuration (`MCP_PRINCIPAL_ID` is required for stdio). The value must be a strict canonical lowercase ASCII identifier. Model-supplied `actorId`, `reviewerId`, and `publisherId` fields are rejected. PostgreSQL also rejects non-canonical `proposals.actor_id`, `revisions.actor_id`, `proposal_reviews.reviewer_id`, and `publication_receipts.publisher_id`. The server stores a SHA-256 digest of the canonical proposal body and of the publication request. Model-supplied `verifierId` is rejected.

| Situation | Outcome |
|---|---|
| New key | `created` |
| Same key and same digest | `replayed` (same proposal or receipt id) |
| Same key and different body | `rejected` / `idempotency_conflict` |
| Malformed or extra fields | `rejected` / `malformed_payload` |
| Commit cannot be confirmed | `ambiguous` — never insert a second row |

Clients must not retry an insert after `ambiguous`. They should read by idempotency key.

## Non-goals

- Replacing public ranking (Phase 5)
- AI-generated forecast publication
- Phase 8 operationalization and production cutover
- Granting any model generic SQL
