# Architecture

Status: Phase 4 (2026-09-09). Schema and domain validators for identity, geography, technology, temporal claims, and durable proposals exist. A bounded collector, exact-JSON extractors, independent verifier, and price normalizer persist fetch receipts and MCP proposals only. Public scoring, wizard shortlisting, and `/updates` still use the Phase 0/1 legacy engine.

## Purpose

`guide.cloudin.asia` is an editorial ASEAN cloud directory. The program goal is to turn the current provider-centric site into an evidence-backed, temporal intelligence platform. Phase 4 adds the collection/extract/verify pipeline on the Phase 3 MCP proposal-only contract. It does not change public ranking or recommendation behavior.

## Current runtime

| Layer | Today |
|---|---|
| Canonical store | PostgreSQL 16 via versioned `migrations/` (schema version 7) |
| Web / API | Next.js 15 + TypeScript in `web/` |
| Scoring | SQL fragments in `web/src/lib/db.ts`, sourced from `web/src/lib/legacy-scoring.ts` (unchanged) |
| Wizard / shortlist | `web/src/lib/needs.ts` (`deriveNeeds`, `shortlistProviders`) (unchanged) |
| Arena ranking | `rankArenaRows` in `web/src/lib/legacy-scoring.ts` (unchanged) |
| Domain types | `packages/domain` validators (not yet wired into public reads) |
| MCP | `mcp/` built-in server (`@modelcontextprotocol/sdk` 1.30.0), contract `packages/contracts` |
| Ingest | `workers/orchestrator.py` (proposal-only MCP client; no direct proposal-table writes). `scripts/ingest_provider.py` and `scripts/daily_refresh.py` remain as deprecated compatibility paths. `scripts/seed.py` is unchanged. |
| Legacy copy | `scripts/migrate_legacy_data.py` (conservative, unlabeled rows stay `legacy/unverified`) |
| Transparency | `directory_updates` table and `/updates` |
| Automated checks | Node test runner, pytest, migration checksum ledger, GitHub Actions CI |

PostgreSQL remains the system of record. The Next.js app is a read-mostly consumer of the public legacy tables. Phase 2/3/4 tables sit beside those tables; they are not the public score path.

## Target boundaries

```text
collectors → immutable fetch receipts
     ↓
AI workers → typed MCP proposals (never canonical writes)
     ↓
deterministic validators → review → versioned revision
     ↓
one scoring/recommendation engine → API, UI, MCP, wizard, compare, methodology
```

Canonical domains now in schema: providers, legal entities, services, offerings, offering versions, locations, facilities, deployments, technologies, fetch snapshots, claims, evidence, proposals, proposal reviews, revisions, collection tasks, model runs.

## Current limitations

1. Provider is still the grain for public stack, score, and most geography. New offering/deployment rows are not consumed by Arena or the wizard.
2. Scores remain regex and presence checks on legacy tables.
3. Wizard shortlisting can still silently widen a one-country filter when fewer than two headquarters match.
4. `/updates` rows are still inserted by scripts, not generated from approved diffs.
5. Conservative legacy copy labels migrated facts `legacy/unverified` and does not fabricate snapshots, legal entities, or exact-facility pins.
6. MCP publication tools are intentionally unavailable. Phase 4 collectors persist immutable fetch receipts and submit proposals; they do not publish. A new scoring engine remains Phase 5.

## Non-goals for this phase

- Replacing public ranking or methodology copy.
- Making publication tools reachable.
- Migrating production data or activating live-network schedulers.
- Treating captured legacy scores as the correct future engine.
- Phase 5 scoring/recommendation unification.

## Consumers that must stay aligned later

Arena, Start/wizard result, Compare, provider pages, methodology, and any future MCP/API read of scores must use one versioned engine. Until Phase 5, the frozen functions in `legacy-scoring.ts` and `needs.ts` are the production baseline those surfaces share.
