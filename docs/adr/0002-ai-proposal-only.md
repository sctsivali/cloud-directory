# ADR 0002: AI workers may only propose

- Status: Implemented in Phase 3 (MCP proposal-only) and Phase 4 (collectors persist receipts and submit proposals; publication still unavailable)
- Date: 2026-09-09
- Phase: 3

## Context

Current ingest scripts write SQL after a page fetch or a JSON document. That path cannot distinguish model invention from a public page, and it cannot prevent a worker from overwriting a verified fact. The program will add multiple AI extractors.

## Decision

AI workers never write canonical facts. They submit typed proposals through a least-privilege MCP contract. Deterministic validators gate every proposal. Humans approve high-impact claims. No model, worker, or MCP client receives generic SQL or unrestricted mutation.

## Consequences

- Direct `INSERT`/`UPDATE` of public facts from an extractor is a defect, including in “authorized lab” framing.
- Proposal identity, digest-bound idempotency, and review exist in schema version 6. Collection tasks and immutable model runs exist in schema version 7. Publication receipts remain Phase 6.
- The built-in MCP server filters discovery by capability and rejects hidden names, including publication tools, before any handler runs.
- Proposal, review, and revision identity is the server-bound `principalId` (`MCP_PRINCIPAL_ID` on stdio), never a model-supplied `actorId` or `reviewerId`.
- A successful model call is still not a canonical write.
