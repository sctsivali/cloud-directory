# ADR 0003: Facts are temporal claims with evidence

- Status: Accepted
- Date: 2026-09-09
- Phase: 0 (decision recorded; claim tables not created)

## Context

The current model stores a latest value on the provider or tier. `sources.scraped_at` is ingest time. A 404 URL still supports the confidence score. Hedged and negated technology sentences are not first-class states. Replay can look like a fresh observation.

## Decision

Public material facts become typed claims with knowledge state, assessment state, observation time, and links to immutable fetch snapshots. Unknown is not false and is not confirmed absence. HTTP success is not verification. Replay/import time must not become observation or freshness time. Provider-level facts do not automatically apply to every offering or deployment.

## Consequences

- Legacy rows migrate as `legacy/unverified` unless evidence and observation time are known (Phase 2).
- City-only evidence cannot create an exact-facility pin.
- Technology inheritance requires explicit universal-scope evidence.
- Phase 0 fixtures include 200, redirect, 403, 404, malformed, and stale sources so those states can be scored and later replaced without inventing history.
