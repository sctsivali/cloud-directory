# Architecture

Status: Phase 3 (2026-09-09). Schema and domain validators for identity, geography, technology, temporal claims, and durable proposals exist. A built-in MCP server exposes versioned read and proposal-only tools. Public scoring, wizard shortlisting, and `/updates` still use the Phase 0/1 legacy engine.

## Purpose

`guide.cloudin.asia` is an editorial ASEAN cloud directory. The program goal is to turn the current provider-centric site into an evidence-backed, temporal intelligence platform. Phase 3 adds a versioned built-in MCP contract and durable proposal/review tables. It does not change public ranking or recommendation behavior.

## Current runtime

| Layer | Today |
|---|---|
| Canonical store | PostgreSQL 16 via versioned `migrations/` (schema version 6) |
| Web / API | Next.js 15 + TypeScript in `web/` |
| Scoring | SQL fragments in `web/src/lib/db.ts`, sourced from `web/src/lib/legacy-scoring.ts` (unchanged) |
| Wizard / shortlist | `web/src/lib/needs.ts` (`deriveNeeds`, `shortlistProviders`) (unchanged) |
| Arena ranking | `rankArenaRows` in `web/src/lib/legacy-scoring.ts` (unchanged) |
| Domain types | `packages/domain` validators (not yet wired into public reads) |
| MCP | `mcp/` built-in server (`@modelcontextprotocol/sdk` 1.30.0), contract `packages/contracts` |
| Ingest | `scripts/ingest_provider.py`, `scripts/daily_refresh.py`, `scripts/seed.py` |
| Legacy copy | `scripts/migrate_legacy_data.py` (conservative, unlabeled rows stay `legacy/unverified`) |
| Transparency | `directory_updates` table and `/updates` |
| Automated checks | Node test runner, pytest, migration checksum ledger, GitHub Actions CI |

PostgreSQL remains the system of record. The Next.js app is a read-mostly consumer of the public legacy tables. Phase 2/3 tables sit beside those tables; they are not the public score path.

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

Canonical domains now in schema: providers, legal entities, services, offerings, offering versions, locations, facilities, deployments, technologies, fetch snapshots, claims, evidence, proposals, proposal reviews, revisions.

## Current limitations

1. Provider is still the grain for public stack, score, and most geography. New offering/deployment rows are not consumed by Arena or the wizard.
2. Scores remain regex and presence checks on legacy tables.
3. Wizard shortlisting can still silently widen a one-country filter when fewer than two headquarters match.
4. `/updates` rows are still inserted by scripts, not generated from approved diffs.
5. Conservative legacy copy labels migrated facts `legacy/unverified` and does not fabricate snapshots, legal entities, or exact-facility pins.
6. MCP publication tools are intentionally unavailable. Collectors and a new scoring engine are still later phases.

## Non-goals for this phase

- Replacing public ranking or methodology copy.
- Collectors, extractors, or a new scoring engine.
- Making publication tools reachable.
- Migrating production data or activating schedulers.
- Treating captured legacy scores as the correct future engine.

## Consumers that must stay aligned later

Arena, Start/wizard result, Compare, provider pages, methodology, and any future MCP/API read of scores must use one versioned engine. Until Phase 5, the frozen functions in `legacy-scoring.ts` and `needs.ts` are the production baseline those surfaces share.
