# ADR 0002: AI workers may only propose

- Status: Accepted
- Date: 2026-09-09
- Phase: 0 (decision recorded; MCP not implemented)

## Context

Current ingest scripts write SQL after a page fetch or a JSON document. That path cannot distinguish model invention from a public page, and it cannot prevent a worker from overwriting a verified fact. The program will add multiple AI extractors.

## Decision

AI workers never write canonical facts. They submit typed proposals through a least-privilege MCP contract. Deterministic validators gate every proposal. Humans approve high-impact claims. No model, worker, or MCP client receives generic SQL or unrestricted mutation.

## Consequences

- Direct `INSERT`/`UPDATE` of public facts from an extractor is a defect, including in “authorized lab” framing.
- Proposal identity, idempotency, review, and publication receipts are required before any AI-written field can appear publicly (Phase 3–4).
- Phase 0 does not add MCP. This ADR exists so later work cannot treat a successful model call as a write.
