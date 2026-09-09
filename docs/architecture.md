# Architecture

Status: Phase 7 (2026-09-09). One versioned offering/deployment scoring and recommendation engine serves Arena, wizard, compare, provider, methodology, and MCP `directory.explain_score`. Verified publication history also feeds trend series, provider/country timelines, and outlook eligibility. Public tables still supply display rows; when canonical offering/deployment subjects are missing, those surfaces use a clearly labeled legacy fallback. `/updates` is generated from published `change_events` with a legacy table fallback.

## Purpose

`guide.cloudin.asia` is an editorial ASEAN cloud directory. The program goal is to turn the current provider-centric site into an evidence-backed, temporal intelligence platform. Phase 4 adds the collection/extract/verify pipeline on the Phase 3 MCP proposal-only contract. It does not change public ranking or recommendation behavior.

## Current runtime

| Layer | Today |
|---|---|
| Canonical store | PostgreSQL 16 via versioned `migrations/` (schema version 11) |
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

Canonical domains now in schema: providers, legal entities, services, offerings, offering versions, locations, facilities, deployments, technologies, fetch snapshots, claims, evidence, proposals, proposal reviews, revisions, collection tasks, model runs, methodology versions, scoring runs, score components, publication receipts, change events, country registry, trend series, outlook assessments, outlook backtests.

## Current limitations

1. Provider is still the public list grain. The engine scores offering/deployment subjects; without those rows, UI/MCP show a labeled legacy fallback.
2. Unknown, confirmed absence, and conflicting stay distinct. Unknown is not scored as zero. Evidence-readiness can move a no-hard-fail subject to `needs_verification`; ranking uses `rankingLowerBound` before raw composite.
3. Wizard production ranking (`recommendWizardRows`) never silently widens country/legal/facility/residency limits. `shortlistProviders` remains only as captured Phase 0 evidence.
4. `/updates` is generated from published `change_events` when present, else the legacy table.
5. Conservative legacy copy labels migrated facts `legacy/unverified` and does not fabricate snapshots, legal entities, or exact-facility pins.
6. MCP publication tools require an explicit `publish` capability. Trend/timeline/outlook-eligibility tools are read-only. Forecasts are not published through MCP.

## Non-goals for this phase

- Replacing public ranking without an editorial review of `scripts/compare_scoring_versions.ts` output.
- AI-generated forecast publication.
- Migrating production data or activating live-network schedulers.
- Phase 8 operationalization or public cutover.

## Consumers that must stay aligned

Arena, Start/wizard result, Compare, provider pages, methodology, and MCP `directory.explain_score` call the same versioned scoring engine. `/trends`, `/provider/[id]/timeline`, `/country/[code]`, `/api/trends`, and MCP `directory.get_trends` / `directory.get_timeline` / `directory.get_outlook_eligibility` call the same intelligence engine. When canonical offering/deployment data is unavailable, scoring surfaces share one labeled legacy fallback. Existing provider, arena, updates, and methodology pages remain.
