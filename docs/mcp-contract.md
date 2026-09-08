# MCP contract (Phase 3, used by Phase 4 workers; Phase 5 explain_score)

Status: Phase 4 workers submit through this same proposal-only contract. Phase 5 points `directory.explain_score` at the shared scoring engine (or a labeled legacy fallback). Built-in Model Context Protocol server for `guide.cloudin.asia`. AI clients may read the directory and submit typed proposals. They cannot publish, execute SQL, or rewrite canonical facts.

## Contract identity

| Field | Value |
|---|---|
| Name | `cloud-directory-mcp` |
| Contract version | `1.0.0` |
| Backing schema version | `8` (`migrations/0008_scoring_runs.sql`) |
| Transport | stdio (official MCP TypeScript SDK) or in-process for tests |

This contract is separate from the public HTTP API and from any WordPress/editorial MCP.

## Capabilities

Server-side only. A client cannot escalate by declaring extra MCP features.

| Capability | Phase 3 |
|---|---|
| `read` | Available. Discovery includes the read tools below. |
| `collect` | Reserved on MCP. Collection runs in `workers/` with injected DNS/HTTP. Workers submit through a transport-level MCP proposal client. Identity is the server-bound principal (`MCP_PRINCIPAL_ID`), not a worker `actor_id`. |
| `propose` | Available. Typed proposal tools only. |
| `review` | Available. Non-approval review decisions. |
| `approve` | Available. Approval cannot be performed by the proposer. |
| `publish` | **Unavailable.** Publication tools stay unreachable even if a session lists `publish`. |

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
- `directory.get_proposal` (status of a durable proposal)

Read tools do not write canonical facts or `/updates`. `explain_score` uses the same offering/deployment engine as Arena, wizard, compare, provider, and methodology. Optional `offeringId` / `deploymentId` select the subject. When no canonical subject exists, the tool returns a payload labeled `legacy-fallback`.

## Proposal-only mutation tools

Canonical writes are not exposed. These tools persist a proposal row:

- `directory.propose_claim`
- `directory.propose_offering`
- `directory.propose_price_observation`
- `directory.propose_location`
- `directory.propose_facility`
- `directory.propose_technology_deployment`
- `directory.propose_retraction`
- `directory.revise_proposal` (body change; an approved proposal returns to review)

There is no generic SQL tool and no arbitrary field-mutation tool. Phase 4 workers invoke these tools over an MCP transport. They do not `INSERT` into `proposals`, `revisions`, or `proposal_reviews`, and they do not send `actorId` / `actor_id` in the tool payload.

## Review tools

- `directory.review_proposal` — `reject` or `request_changes`
- `directory.approve_proposal` — forbidden when the bound `principalId` equals the proposer

Approvals are invalidated when the proposal body changes.

## Publication tools (unavailable)

Reserved names, not registered, not reachable in Phase 3:

- `directory.publish_revision`
- `directory.publish_change`

Direct invocation by name is rejected before handler execution.

## Idempotency and outcomes

Proposal tools require `idempotencyKey`. Actor, reviewer, and revision identity come from a non-model-controlled `principalId` on `ToolContext` / server configuration (`MCP_PRINCIPAL_ID` is required for stdio). The value must be a strict canonical lowercase ASCII identifier. Model-supplied `actorId` and `reviewerId` fields are rejected. PostgreSQL also rejects non-canonical `proposals.actor_id`, `revisions.actor_id`, and `proposal_reviews.reviewer_id`. The server stores a SHA-256 digest of the canonical proposal body.

| Situation | Outcome |
|---|---|
| New key | `created` |
| Same key and same digest | `replayed` (same proposal id) |
| Same key and different body | `rejected` / `idempotency_conflict` |
| Malformed or extra fields | `rejected` / `malformed_payload` |
| Commit cannot be confirmed | `ambiguous` — never insert a second row |

Clients must not retry an insert after `ambiguous`. They should read by idempotency key.

## Non-goals

- Collectors and extractors (Phase 4)
- Replacing public ranking (Phase 5)
- Generating `/updates` from revisions (Phase 6)
- Granting any model generic SQL
