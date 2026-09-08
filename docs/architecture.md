# Architecture

Status: Phase 0 baseline (2026-09-09). This document freezes current boundaries and the target shape. It does not authorize schema changes, migrations, collectors, or publication.

## Purpose

`guide.cloudin.asia` is an editorial ASEAN cloud directory. The program goal is to turn the current provider-centric site into an evidence-backed, temporal intelligence platform. Phase 0 only records the baseline so later phases can change schema and algorithms without losing known behavior.

## Current runtime

| Layer | Today |
|---|---|
| Canonical store | PostgreSQL 16 (`schema.sql` plus ad-hoc SQL under `data/ingest/`) |
| Web / API | Next.js 15 + TypeScript in `web/` |
| Scoring | SQL fragments in `web/src/lib/db.ts`, now sourced from `web/src/lib/legacy-scoring.ts` |
| Wizard / shortlist | `web/src/lib/needs.ts` (`deriveNeeds`, `shortlistProviders`) |
| Arena ranking | `rankArenaRows` in `web/src/lib/legacy-scoring.ts`, used by `ArenaView` |
| Ingest | `scripts/ingest_provider.py`, `scripts/daily_refresh.py`, `scripts/seed.py` |
| Transparency | `directory_updates` table and `/updates` |
| Automated checks | No package test suite existed before this baseline corpus |

PostgreSQL remains the system of record. The Next.js app is a read-mostly consumer. Python scripts write rows directly.

## Target boundaries (not implemented in Phase 0)

```text
collectors → immutable fetch receipts
     ↓
AI workers → typed MCP proposals (never canonical writes)
     ↓
deterministic validators → review → versioned revision
     ↓
one scoring/recommendation engine → API, UI, MCP, wizard, compare, methodology
```

Canonical domains (future): providers, legal entities, services, offerings, deployments, locations, facilities, technologies, claims, evidence, observations, revisions.

## Current limitations

1. Provider is the grain for stack, score, and most geography. Packages (`tiers`) do not have independent evidence or inheritance rules.
2. Scores are regex and presence checks. Unknown, hedged, negated, stale, and failed fetches often collapse to the same number.
3. Wizard shortlisting can silently widen a one-country filter when fewer than two headquarters match.
4. Arena ranking and wizard shortlisting do not share one country-filter rule.
5. `/updates` rows are inserted by scripts, not generated from approved diffs.
6. Ingest uses process-time `now()` and can stamp every source `OK`.
7. There is no proposal, review, revision, or MCP boundary.

## Non-goals for this baseline

- Replacing public ranking or methodology copy.
- Standing up MCP, collectors, or a new domain package.
- Migrating production data or activating schedulers.
- Treating captured legacy scores as the correct future engine.

## Consumers that must stay aligned later

Arena, Start/wizard result, Compare, provider pages, methodology, and any future MCP/API read of scores must use one versioned engine. Until Phase 5, the frozen functions in `legacy-scoring.ts` and `needs.ts` are the production baseline those surfaces share.
