# Cloud Directory Intelligence Platform Implementation Plan

> **For Hermes:** Use the approved coding-runner chain and strict TDD to implement this plan task-by-task. No production deployment, database migration, scheduler activation, or publication is authorized by this plan.

**Goal:** Transform `guide.cloudin.asia` from a provider-centric directory into an evidence-backed, temporal ASEAN cloud intelligence platform with a built-in MCP contract, multi-AI proposal workflow, deterministic scoring, transparent revisions, trends, and eventually calibrated outlooks.

**Architecture:** PostgreSQL remains the canonical system of record. A versioned domain layer separates providers, legal entities, services, offerings, deployments, locations, facilities, technologies, claims, evidence, observations, and revisions. AI workers never write canonical facts directly: collectors persist immutable fetch receipts, AI workers submit typed proposals through MCP, deterministic validators gate them, humans approve high-impact claims, and one versioned scoring/recommendation engine serves API, UI, MCP, wizard, compare, and methodology.

**Tech Stack:** PostgreSQL 16; Next.js/TypeScript for web/API/domain engine; official MCP SDK for the built-in MCP server; Python for bounded collectors/extractors where useful; Vitest for TypeScript unit tests; pytest for Python workers; PostgreSQL integration tests; Playwright for critical web flows; GitHub Actions for CI.

---

## 1. Product outcome

The platform must answer four different questions without mixing their semantics:

1. **Current state:** What is publicly supported now?
2. **Change:** What changed, when, and based on which evidence?
3. **Intelligence:** What patterns can be calculated from verified historical observations?
4. **Outlook:** What future direction is suggested, with assumptions, uncertainty, and backtesting?

A provider count or AI-generated narrative is not intelligence by itself. Every public result must be reproducible from a data revision, methodology version, and evidence set.

## 2. Current baseline and assumptions

Repository baseline reviewed:

- Repository: `sctsivali/cloud-directory`
- Branch: `main`
- Commit: `85c80d8e848d6660827222fb7ecdfe5d1ac704fe`
- Current schema: `schema.sql` plus fragmented SQL under `data/ingest/`
- Current scoring: `web/src/lib/db.ts`
- Current recommendation logic: `web/src/lib/needs.ts`
- Current collector/ingestion: `scripts/daily_refresh.py`, `scripts/ingest_provider.py`
- Current public transparency feed: `directory_updates`, `/updates`
- Current automated checks: one duplicated sanity script; no proper test suite or GitHub Actions workflow

Assumptions:

- PostgreSQL remains canonical.
- Existing public routes remain available during migration.
- Existing data is migrated as `legacy/unverified` unless evidence and observation time are known.
- Production remains read-only until a separately approved migration/cutover.
- WordPress/CIA Editorial MCP remains a separate product boundary.

## 3. Non-negotiable invariants

1. Unknown is not false and is not confirmed absence.
2. HTTP success is not claim verification.
3. Provider-level facts do not automatically apply to every offering or deployment.
4. Replay/import time must not become observation/freshness time.
5. AI output is always an untrusted proposal until deterministic validation and applicable review succeed.
6. Hard user constraints cannot be silently relaxed by ranking.
7. Public scoring, API, wizard, compare, and methodology use one versioned engine.
8. Every published change has before/after values, evidence, revision identity, and rollback lineage.
9. Outlooks remain distinct from observed facts and trends.
10. No model, worker, or MCP client receives generic SQL or unrestricted mutation capability.

## 4. Target repository layout

```text
cloud-directory/
├── migrations/
│   ├── 0001_legacy_baseline.sql
│   ├── 0002_entities_services_offerings.sql
│   ├── 0003_locations_facilities_deployments.sql
│   ├── 0004_technologies.sql
│   ├── 0005_claims_evidence_snapshots.sql
│   ├── 0006_proposals_reviews_revisions.sql
│   ├── 0007_scoring_runs.sql
│   └── manifest.json
├── packages/
│   ├── domain/
│   │   ├── src/entities.ts
│   │   ├── src/knowledge-state.ts
│   │   ├── src/claim-validation.ts
│   │   ├── src/scoring/
│   │   └── src/recommendation/
│   └── contracts/
│       ├── src/mcp.ts
│       ├── src/api.ts
│       └── src/events.ts
├── mcp/
│   ├── src/server.ts
│   ├── src/authz.ts
│   ├── src/read-tools.ts
│   ├── src/proposal-tools.ts
│   ├── src/review-tools.ts
│   └── src/publication-tools.ts
├── workers/
│   ├── collector/
│   ├── extractor/
│   ├── verifier/
│   └── pricing/
├── web/
├── tests/
│   ├── fixtures/
│   ├── integration/
│   └── e2e/
└── docs/
    ├── architecture.md
    ├── data-model.md
    ├── methodology.md
    ├── mcp-contract.md
    └── operations.md
```

## 5. Target data domains

### Identity and ownership

- `providers`
- `legal_entities`
- `provider_entity_relationships`

### Catalog and commercial observations

- `services`
- `offerings`
- `offering_versions`
- `price_observations`

### Geography and physical infrastructure

- `locations`
- `facilities`
- `deployments`
- `deployment_facilities`
- `map_projections` as a derived view, not canonical facts

Map precision enum:

- `facility_exact`
- `campus`
- `city_centroid`
- `region_centroid`
- `undisclosed`

### Technology

- `technologies`
- `technology_versions`
- `technology_deployments`

### Evidence and time

- `sources`
- `fetch_snapshots`
- `claims`
- `evidence`
- `claim_evidence`

Knowledge state enum:

- `present`
- `confirmed_absent`
- `unknown`
- `not_applicable`
- `conflicting`

Assessment state enum:

- `extracted`
- `inferred`
- `provider_asserted`
- `editorially_reviewed`
- `independently_verified`
- `rejected`

### Workflow and transparency

- `collection_tasks`
- `proposals`
- `proposal_reviews`
- `revisions`
- `change_events`
- `publication_receipts`
- `correction_requests`

### Analytics

- `methodology_versions`
- `scoring_runs`
- `score_components`
- `trend_series`
- `outlook_assessments`
- `outlook_backtests`

---

# Phase 0 — Freeze baseline and define acceptance corpus

**Duration:** 3–5 working days

**Objective:** Preserve current behavior and representative data before changing schema or algorithms.

### Task 0.1: Add architecture decision records

**Files:**
- Create: `docs/architecture.md`
- Create: `docs/data-model.md`
- Create: `docs/methodology.md`
- Create: `docs/adr/0001-canonical-postgres.md`
- Create: `docs/adr/0002-ai-proposal-only.md`
- Create: `docs/adr/0003-temporal-claims.md`

Document current limitations, target boundaries, terminology, and non-goals.

### Task 0.2: Build sanitized regression fixtures

**Files:**
- Create: `tests/fixtures/providers/*.json`
- Create: `tests/fixtures/sources/*.html`
- Create: `tests/fixtures/expected/*.json`

Fixtures must cover:

- local provider with public packages;
- local provider without packages;
- global provider with ASEAN region;
- multi-region provider;
- exact facility versus city-only disclosure;
- confirmed KVM, hedged KVM, and negated KVM;
- current price, annual commitment, promo price, and unsupported currency;
- source 200, redirect, 403, 404, malformed response, and stale evidence.

### Task 0.3: Capture legacy algorithm outputs

**Files:**
- Create: `tests/fixtures/legacy-scores.json`
- Create: `tests/fixtures/legacy-shortlists.json`

Record SOV, CONF, OSS, Arena ordering, wizard outputs, and compare values for the acceptance corpus. These fixtures are comparison evidence, not expected behavior for the new engine.

**Gate:** Baseline fixtures are sanitized, immutable, documented, and sufficient to reproduce known defects.

---

# Phase 1 — Reproducible database and CI foundation

**Duration:** 1–2 weeks

**Objective:** Make a clean installation and upgrade path reproducible before adding new intelligence features.

### Task 1.1: Introduce versioned migrations

**Files:**
- Create: `migrations/0001_legacy_baseline.sql`
- Create: `migrations/manifest.json`
- Create: `scripts/migrate.py`
- Create: `tests/integration/test_migrations.py`
- Deprecate migration behavior scattered across `data/ingest/*.sql`

Tests:

1. Empty PostgreSQL database migrates to current schema.
2. Representative legacy schema upgrades without data loss.
3. Failed late migration rolls back fully.
4. Migration checksum mismatch fails closed.
5. Newer unsupported schema version fails closed.

### Task 1.2: Remove absolute-path and nondeterministic seed behavior

**Files:**
- Modify: `scripts/seed.py`
- Modify: `scripts/daily_refresh.py`
- Create: `tests/test_seed.py`

Replace external absolute paths with explicit CLI parameters. Replace Python `hash()` identifiers with stable IDs derived from canonical inputs.

### Task 1.3: Add canonical test commands

**Files:**
- Modify: `web/package.json`
- Create: `pyproject.toml`
- Create: `.github/workflows/ci.yml`

Commands:

```bash
npm ci
npm run typecheck
npm run test
npm run build
python -m pytest
```

CI gates:

- dependency installation from lock files;
- TypeScript checks;
- unit and integration tests;
- Python tests;
- clean-database migration;
- legacy upgrade migration;
- production Next.js build;
- generated contract drift check.

**Gate:** A fresh checkout can create a compatible database and pass all tests without external unpublished files.

---

# Phase 2 — Temporal claim and evidence foundation

**Duration:** 2–3 weeks

**Objective:** Replace provider-level source links with typed, temporal, claim-level evidence.

### Task 2.1: Add normalized identity/catalog migrations

**Files:**
- Create: `migrations/0002_entities_services_offerings.sql`
- Create: `packages/domain/src/entities.ts`
- Create: `packages/domain/src/entity-validation.ts`
- Create: `packages/domain/test/entities.test.ts`

Implement provider, legal entity, service, offering, and offering-version identities.

### Task 2.2: Add deployment/location/facility model

**Files:**
- Create: `migrations/0003_locations_facilities_deployments.sql`
- Create: `packages/domain/src/geography.ts`
- Create: `packages/domain/test/geography.test.ts`

Tests must prove that city-only evidence cannot create an exact-facility map pin.

### Task 2.3: Add technology catalog and scoped deployment relations

**Files:**
- Create: `migrations/0004_technologies.sql`
- Create: `packages/domain/src/technology.ts`
- Create: `packages/domain/test/technology.test.ts`

Technology may apply to provider, service, offering, or deployment. Inheritance is permitted only with explicit universal-scope evidence.

### Task 2.4: Add claims, evidence, and immutable fetch snapshots

**Files:**
- Create: `migrations/0005_claims_evidence_snapshots.sql`
- Create: `packages/domain/src/knowledge-state.ts`
- Create: `packages/domain/src/claim-validation.ts`
- Create: `packages/domain/test/claims.test.ts`

Tests:

- unknown differs from false and confirmed absence;
- one source may support one claim while not supporting another;
- contradictory evidence produces `conflicting`;
- replay/import does not change observation time;
- expired evidence cannot be presented as freshly verified;
- quoted excerpt must exist in the referenced immutable snapshot.

### Task 2.5: Migrate legacy rows conservatively

**Files:**
- Create: `scripts/migrate_legacy_data.py`
- Create: `tests/integration/test_legacy_data_migration.py`

Rules:

- preserve original value and timestamps when known;
- label unsupported values `legacy/unverified`;
- do not fabricate source, observed time, legal identity, or facility precision;
- retain lineage back to original table/row.

**Gate:** Provider, offering, location, facility, and technology facts can each be traced to typed evidence and observation history.

---

# Phase 3 — Built-in MCP, proposal-only

**Duration:** 2 weeks

**Objective:** Provide a stable, least-privilege MCP contract for multiple AI clients without granting direct canonical writes.

### Task 3.1: Define versioned MCP schemas

**Files:**
- Create: `packages/contracts/src/mcp.ts`
- Create: `docs/mcp-contract.md`
- Create: `packages/contracts/test/mcp-contract.test.ts`

Read tools:

- `directory.get_provider`
- `directory.search_providers`
- `directory.get_offerings`
- `directory.get_claims`
- `directory.get_evidence`
- `directory.get_source_snapshot`
- `directory.explain_score`
- `directory.get_quality_report`

Proposal tools:

- `directory.propose_claim`
- `directory.propose_offering`
- `directory.propose_price_observation`
- `directory.propose_location`
- `directory.propose_facility`
- `directory.propose_technology_deployment`
- `directory.propose_retraction`

Do not expose generic SQL or arbitrary field mutation.

### Task 3.2: Implement MCP authorization boundary

**Files:**
- Create: `mcp/src/server.ts`
- Create: `mcp/src/authz.ts`
- Create: `mcp/test/authz.test.ts`

Capabilities:

- `read`
- `collect`
- `propose`
- `review`
- `approve`
- `publish`

Tests must invoke hidden tools by direct name and prove rejection before handler execution.

### Task 3.3: Add durable idempotent proposal workflow

**Files:**
- Create: `migrations/0006_proposals_reviews_revisions.sql`
- Create: `mcp/src/proposal-tools.ts`
- Create: `mcp/test/proposals.test.ts`

Tests:

- same idempotency key and same body returns same result;
- same key with altered body is rejected;
- malformed model output cannot create a proposal;
- proposal cannot self-approve;
- modifying an approved proposal returns it to review;
- transport ambiguity never causes a blind duplicate mutation.

**Gate:** An authorized AI can submit a proposal but cannot directly publish or rewrite canonical facts.

---

# Phase 4 — Collection and multi-AI enrichment

**Duration:** 3–4 weeks for initial lanes; continuous afterward

**Objective:** Replace direct SQL ingestion with a durable fetch/extract/verify/review pipeline.

### Task 4.1: Build bounded collector

**Files:**
- Create: `workers/collector/fetch.py`
- Create: `workers/collector/policy.py`
- Create: `workers/collector/test_fetch.py`
- Deprecate fetch behavior in `scripts/daily_refresh.py`

Controls:

- URL allow/policy validation;
- no localhost/private-network SSRF;
- redirects disabled or explicitly bounded and revalidated;
- content type and byte limits;
- total fetch deadline;
- immutable content hash;
- source and final URL receipts;
- 403/404/timeout remain distinct states.

### Task 4.2: Build extraction adapters

**Files:**
- Create: `workers/extractor/contract.py`
- Create: `workers/extractor/provider.py`
- Create: `workers/extractor/offering.py`
- Create: `workers/extractor/facility.py`
- Create: `workers/extractor/technology.py`
- Create: `workers/extractor/tests/`

Every AI adapter receives a least-data snapshot and returns exact JSON. Treat page text as prompt-injection-capable data. Persist model/provider, ruleset version, input digest, output digest, and timestamps.

### Task 4.3: Add independent verification lane

**Files:**
- Create: `workers/verifier/verify_claim.py`
- Create: `workers/verifier/tests/test_verify_claim.py`

Verification checks:

- exact excerpt exists;
- assertion is about the correct provider/service/offering;
- negation and hedging;
- evidence scope;
- conflicting claims;
- source authority;
- freshness.

AI disagreement produces `conflicting/needs_review`, not majority truth.

### Task 4.4: Add price normalization lane

**Files:**
- Create: `workers/pricing/normalize.py`
- Create: `workers/pricing/tests/`

Store amount, currency, billing unit, commitment, promo, renewal, tax, region, source, and FX observation. Unsupported currency must fail rather than reuse an IDR fallback.

### Task 4.5: Replace legacy refresh

**Files:**
- Modify or retire: `scripts/daily_refresh.py`
- Modify or retire: `scripts/ingest_provider.py`
- Create: `workers/orchestrator.py`
- Create: `tests/integration/test_collection_pipeline.py`

Pipeline:

```text
scheduled task
→ fetch snapshot
→ extract proposals
→ deterministic validation
→ independent verification
→ review queue
→ approved revision
```

**Gate:** Replaying stored JSON cannot change freshness, and no AI output can reach public data without a proposal/review trail.

---

# Phase 5 — Deterministic scoring and recommendation engine

**Duration:** 2–3 weeks

**Objective:** Replace regex/provider-level scores and sort-only recommendations with one versioned offering/deployment engine.

### Task 5.1: Define methodology as versioned data

**Files:**
- Create: `packages/domain/src/scoring/methodology.ts`
- Create: `migrations/0007_scoring_runs.sql`
- Create: `packages/domain/test/methodology.test.ts`

Dimensions:

- primary-data residency;
- backup residency;
- metadata/control-plane residency;
- contracting entity and legal control;
- administrative access and key control;
- evidence coverage;
- evidence quality;
- open technology and portability;
- commercial comparability.

Do not collapse unknown into zero.

### Task 5.2: Implement hard constraints and preferences

**Files:**
- Create: `packages/domain/src/recommendation/constraints.ts`
- Create: `packages/domain/src/recommendation/ranking.ts`
- Modify: `web/src/lib/needs.ts`
- Create: `packages/domain/test/recommendation.test.ts`

Results:

- `eligible`
- `needs_verification`
- `excluded`

Country, legal entity, facility, and residency requirements must be evaluated on the relevant offering/deployment and cannot be silently relaxed.

### Task 5.3: Unify application consumers

**Files:**
- Refactor: `web/src/lib/db.ts`
- Refactor: `web/src/components/ArenaView.tsx`
- Refactor: `web/src/components/StartResultView.tsx`
- Refactor: `web/src/components/CompareView.tsx`
- Refactor: `web/src/components/ProviderView.tsx`
- Refactor: `web/src/components/MethodologyView.tsx`

All consumers use shared metric descriptors, comparators, labels, score breakdowns, and tie-breakers.

### Task 5.4: Shadow-score current production snapshot

**Files:**
- Create: `scripts/compare_scoring_versions.ts`
- Create: `docs/reports/scoring-shadow-template.md`

Report ranking changes with reason codes. Do not replace public ranking until material changes are editorially reviewed.

**Gate:** Same data revision and methodology version always produce the same results across MCP, API, wizard, Arena, compare, and methodology explanation.

---

# Phase 6 — Revision ledger and automatic transparency feed

**Duration:** 1–2 weeks

**Objective:** Generate `/updates` from approved canonical changes, not hand-written generic rows.

### Task 6.1: Implement revision publication transaction

**Files:**
- Create: `packages/domain/src/revisions/publish.ts`
- Create: `packages/domain/test/revisions.test.ts`
- Create: `mcp/src/publication-tools.ts`

A publication transaction must bind:

- proposal set;
- before/after values;
- evidence snapshot IDs;
- reviewer and approval digest;
- methodology version;
- data revision;
- publication receipt.

### Task 6.2: Generate public change events

**Files:**
- Refactor: `web/src/lib/db.ts:getDirectoryUpdates`
- Refactor: `web/src/components/UpdatesView.tsx`
- Modify: `web/src/app/api/updates/route.ts`
- Retire generic update insertion in `scripts/daily_refresh.py`

Public update fields:

- entity and field changed;
- old and new values when safe;
- source;
- detected/observed/reviewed/published times;
- revision link;
- change type;
- correction provenance where relevant.

### Task 6.3: Add rollback and supersession

**Files:**
- Create: `packages/domain/src/revisions/rollback.ts`
- Create: `packages/domain/test/rollback.test.ts`

Rollback creates a new revision; it must not erase history.

**Gate:** Every public update corresponds exactly to an approved revision and can be traced or reversed without deleting history.

---

# Phase 7 — Intelligence and trend products

**Duration:** Start after sufficient observation history; 3–4 weeks for first dashboards

**Objective:** Turn verified history into explainable metrics before attempting forecasts.

### Task 7.1: Add materialized trend series

**Files:**
- Create: `packages/domain/src/intelligence/trends.ts`
- Create: `packages/domain/test/trends.test.ts`
- Create: `web/src/app/trends/page.tsx`
- Create: `web/src/app/api/trends/route.ts`

Initial metrics:

- offering and provider count by country;
- public price index by comparable basket;
- region/facility expansion;
- technology adoption;
- evidence coverage and freshness;
- concentration by provider/facility/operator;
- verified additions, retractions, and conflicts.

### Task 7.2: Add provider and country timelines

**Files:**
- Create: `web/src/app/provider/[id]/timeline/page.tsx`
- Create: `web/src/app/country/[code]/page.tsx`
- Create: `packages/domain/src/intelligence/timeline.ts`

### Task 7.3: Define outlook contract

**Files:**
- Create: `packages/domain/src/intelligence/outlook.ts`
- Create: `docs/outlook-methodology.md`
- Create: `packages/domain/test/outlook.test.ts`

Every outlook separates:

- observed facts;
- measured trend;
- signal;
- assessment;
- forecast.

Required fields:

- observation period;
- baseline;
- supporting and contradicting indicators;
- assumptions;
- confidence band;
- model/ruleset version;
- expiry date;
- backtest result when available.

### Task 7.4: Establish minimum evidence gate for forecasting

Do not publish forecasts until there is sufficient longitudinal coverage for the selected metric. The gate must be metric-specific, not merely “90 days elapsed.” It should consider observation count, source continuity, comparable population, revisions, and missingness.

**Gate:** Trend outputs reproduce from revision history, and outlooks are visibly distinct from facts with calibrated uncertainty.

---

# Phase 8 — Operationalization and continuous enrichment

**Duration:** Continuous

**Objective:** Safely scale source coverage, model diversity, and editorial usefulness.

Workstreams:

1. Source registry expansion by country and domain.
2. New specialist AI adapters with conformance tests.
3. Human-labeled evaluation corpus.
4. Precision/recall measurement for each extractor type.
5. Model/ruleset regression evaluation before upgrades.
6. Data-quality SLOs and coverage dashboards.
7. Correction response and dispute handling.
8. Periodic methodology review with versioned changes.
9. Cost, latency, and queue-capacity monitoring.
10. Public documentation and downloadable revision-bound datasets.

## 6. Human approval policy

### Potentially automatable after calibration

- exact redirect update;
- source availability status;
- unchanged snapshot receipt;
- formatting/canonicalization with no semantic change;
- low-risk duplicate-source clustering.

### Human review required

- legal entity and ownership;
- contracting jurisdiction;
- residency/control claims;
- facility identity and exact map coordinates;
- material price normalization;
- technology deployment scope;
- correction dispute;
- methodology or score change;
- public trend interpretation or outlook.

## 7. Quality and security test matrix

Required adversarial cases:

- prompt injection embedded in a provider page;
- localhost/private-IP URL and redirect;
- oversized or malformed source response;
- HTTP 403 with misleading HTML;
- exact claim quotation absent from snapshot;
- negated and hedged technology statements;
- office address mistaken for DC location;
- provider-level stack incorrectly inherited by a package;
- one regional deployment incorrectly applied globally;
- same idempotency key with altered payload;
- stale evidence presented as current;
- proposal modified after approval;
- crash before/after revision commit;
- duplicate publication retry;
- migration failure with populated legacy rows;
- one-country shortlist with automatic-relaxation attempt;
- score tie and deterministic ordering;
- conflicting sources and retraction.

## 8. Release and cutover strategy

1. Build and test everything against a disposable PostgreSQL environment.
2. Create a sanitized production-shape fixture.
3. Deploy schema and services in inactive/proposal-only mode.
4. Verify read-only MCP and data parity.
5. Run AI collection into proposal queues without publication.
6. Compare proposals against human decisions and measure extractor performance.
7. Run new scoring in shadow mode.
8. Review material ranking changes.
9. Obtain separate approval for production migration and public cutover.
10. Preserve rollback to prior app/data revision while retaining new audit history.

## 9. Milestones

| Milestone | Meaning | Target phases |
|---|---|---|
| M1 Reproducible | Clean DB, migrations, CI, fixtures | 0–1 |
| M2 Evidence-backed | Temporal claims and evidence exist | 2 |
| M3 MCP proposal-only | Multiple AI workers can safely propose | 3 |
| M4 Automated enrichment | Collection/extraction/verification pipeline | 4 |
| M5 Trustworthy screening | Versioned constraints and scoring | 5 |
| M6 Transparent revisions | `/updates` generated from approved changes | 6 |
| M7 Intelligence | Trends and timelines from history | 7 |
| M8 Outlook | Calibrated, backtested outlook products | 7–8 |

## 10. Definition of done for the program

The program is not complete merely because an MCP server starts or AI can populate fields. It is complete when:

- every public material fact has traceable evidence and temporal state;
- all canonical changes pass proposal/review/publication states;
- one data revision reproduces the same API/UI/MCP output;
- wizard hard constraints cannot be silently relaxed;
- score components and uncertainty are explainable;
- `/updates` is automatically generated from actual approved diffs;
- legacy data is visibly distinguished from verified observations;
- multiple AI providers pass the same contract and evaluation suite;
- trends derive from sufficient longitudinal observations;
- outlooks expose assumptions, contradictory signals, confidence, and backtests;
- a separately approved production rollout passes migration, rollback, security, and public-readback gates.

## 11. Immediate first sprint recommendation

Start only with Phases 0 and 1:

1. Architecture/data-model ADRs.
2. Sanitized regression corpus.
3. Versioned migration runner.
4. Fresh and upgrade database tests.
5. Canonical test commands and CI.
6. Dependency remediation plan for current `next`, `postcss`, and `sharp` audit findings.

Do not build multi-AI automation before this foundation passes. Otherwise automation will populate data faster than the platform can prove, review, or safely revise it.
