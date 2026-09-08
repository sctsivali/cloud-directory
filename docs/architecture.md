# Architecture

Status: Phase 5 (2026-09-09). One versioned offering/deployment scoring and recommendation engine now serves Arena, wizard, compare, provider, methodology, and MCP `directory.explain_score`. Public tables still supply display rows; when canonical offering/deployment subjects are missing, those surfaces use a clearly labeled legacy fallback. `/updates` is still the Phase 0/1 feed (Phase 6).

## Purpose

`guide.cloudin.asia` is an editorial ASEAN cloud directory. The program goal is to turn the current provider-centric site into an evidence-backed, temporal intelligence platform. Phase 4 adds the collection/extract/verify pipeline on the Phase 3 MCP proposal-only contract. It does not change public ranking or recommendation behavior.

## Current runtime

| Layer | Today |
|---|---|
| Canonical store | PostgreSQL 16 via versioned `migrations/` (schema version 8) |
| Web / API | Next.js 15 + TypeScript in `web/` |
| Scoring | `packages/domain/src/scoring` (`asean-offering-deployment-v1`). SQL SOV/OSS/CONF remain the labeled legacy fallback. |
| Wizard / shortlist | `recommendWizardRows` (no silent country relaxation). `shortlistProviders` kept as the Phase 0 captured defect. |
| Arena ranking | Shared metric descriptors plus `rankArenaRows` when only legacy provider rows exist |
| Domain types | `packages/domain` validators and the scoring/recommendation engine |
| MCP | `mcp/` built-in server (`@modelcontextprotocol/sdk` 1.30.0), contract `packages/contracts` |
| Ingest | `workers/orchestrator.py` (proposal-only MCP client; no direct proposal-table writes). `scripts/ingest_provider.py` and `scripts/daily_refresh.py` remain as deprecated compatibility paths. `scripts/seed.py` is unchanged. |
| Legacy copy | `scripts/migrate_legacy_data.py` (conservative, unlabeled rows stay `legacy/unverified`) |
| Transparency | `directory_updates` table and `/updates` |
| Automated checks | Node test runner, pytest, migration checksum ledger, GitHub Actions CI |

PostgreSQL remains the system of record. The Next.js app is a read-mostly consumer of the public legacy tables. Phase 2–4 tables sit beside those tables. Phase 5 adds `methodology_versions`, `scoring_runs`, and `score_components`. Public ranking is not cut over until editorial review of the shadow report.

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

Canonical domains now in schema: providers, legal entities, services, offerings, offering versions, locations, facilities, deployments, technologies, fetch snapshots, claims, evidence, proposals, proposal reviews, revisions, collection tasks, model runs, methodology versions, scoring runs, score components.

## Current limitations

1. Provider is still the public list grain. The engine scores offering/deployment subjects; without those rows, UI/MCP show a labeled legacy fallback.
2. Unknown, confirmed absence, and conflicting stay distinct. Unknown is not scored as zero. Evidence-readiness can move a no-hard-fail subject to `needs_verification`; ranking uses `rankingLowerBound` before raw composite.
3. Wizard production ranking (`recommendWizardRows`) never silently widens country/legal/facility/residency limits. `shortlistProviders` remains only as captured Phase 0 evidence.
4. `/updates` rows are still inserted by scripts, not generated from approved diffs.
5. Conservative legacy copy labels migrated facts `legacy/unverified` and does not fabricate snapshots, legal entities, or exact-facility pins.
6. MCP publication tools stay unavailable. `directory.explain_score` uses the shared engine or the labeled fallback.

## Non-goals for this phase

- Replacing public ranking without an editorial review of `scripts/compare_scoring_versions.ts` output.
- Making publication tools reachable (Phase 6).
- Migrating production data or activating live-network schedulers.
- Treating captured legacy scores as the correct future engine.

## Consumers that must stay aligned

Arena, Start/wizard result, Compare, provider pages, methodology, and MCP `directory.explain_score` call the same versioned engine. When canonical offering/deployment data is unavailable, they share one labeled legacy fallback.
