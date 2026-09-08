# Data model

Status: Phase 3. Public legacy tables from `migrations/0001_legacy_baseline.sql` remain the score/API grain. Migrations 0002–0005 add canonical identity, geography, technology, and evidence tables beside them. Migration 0006 adds durable proposals, reviews, and revisions. No production cutover is authorized by this document.

## Public legacy tables (unchanged grain)

### Identity

`providers` is still the public identity grain. Fields mix brand, headquarters, legal home, origin (`local` / `regional` / `global` / `unknown`), and `is_local_asean`. `legal_country` is a string, not a legal-entity row.

### Catalog and price

`tiers` stores public packages on a provider. Price is a single `price_usd_month` plus optional native amount and currency.

### Geography

`locations` and `provider_locations` record city/country pairs. Phase 2 adds `locations.map_precision` with default `undisclosed` so existing coordinates are not treated as exact-facility pins. `buildings` and `provider_buildings` remain the public hall tables. `listed` is still the only public precision flag those surfaces use.

### Technology

`stacks` is still one row per provider for public OSS scoring. The new technology catalog does not feed `legacy-scoring.ts`.

### Evidence and time

`sources` is still a URL list with `scraped_at` and `status`. HTTP success is not verification.

### Transparency

`directory_updates` is still a hand-written or script-inserted feed.

## Phase 2 canonical tables

### Identity and catalog (`0002_entities_services_offerings.sql`)

- `legal_entities` — named legal identity; never inferred from `providers.legal_country` alone.
- `provider_entity_relationships` — brand / operator / contracting / parent / subsidiary / unknown, with optional validity window.
- `services` — provider catalog grouping.
- `offerings` — commercial products; legacy `tiers` copy in with lineage `(legacy_table, legacy_pk)`.
- `offering_versions` — versioned attributes; `observed_at` is copied from `tiers.updated_at` when known and is distinct from `recorded_at`.

### Geography (`0003_locations_facilities_deployments.sql`)

Map precision enum: `facility_exact`, `campus`, `city_centroid`, `region_centroid`, `undisclosed`.

- `facilities` — canonical halls with lineage to `buildings`. Conservative copy always uses `undisclosed`.
- `deployments` — provider presence at a location; optional offering scope.
- `deployment_facilities` — which facilities a deployment uses.
- `map_projections` — **view**, not a fact table. `is_exact_pin` is true only for `facility_exact` with coordinates. City-only evidence cannot create that pin.

### Technology (`0004_technologies.sql`)

- `technologies` / `technology_versions`
- `technology_deployments` — `scope` in `provider`, `service`, `offering`, `deployment`. `has_universal_scope_evidence` defaults false; provider-level rows do not inherit onto offerings without it.

### Claims and evidence (`0005_claims_evidence_snapshots.sql`)

- `fetch_snapshots` — immutable (UPDATE/DELETE raise). `fetched_at` is the fetch clock; `recorded_at` is ingest/replay.
- `claims` — typed subject, `knowledge_state`, `assessment_state`, optional `observed_at` (no default), `valid_from` / `valid_to`.
- `evidence` — excerpt against a snapshot; excerpt must occur in snapshot body.
- `claim_evidence` — `supports` / `contradicts` / `neutral`.

Knowledge state: `present`, `confirmed_absent`, `unknown`, `not_applicable`, `conflicting`.

Assessment state: `extracted`, `inferred`, `provider_asserted`, `editorially_reviewed`, `independently_verified`, `rejected`, plus `legacy/unverified` for conservative migration.

Unknown is not false and is not confirmed absence. Contradictory stances resolve to `conflicting`. Expired `valid_to` cannot be presented as freshly verified.

## Conservative legacy copy

`scripts/migrate_legacy_data.py` copies existing public rows into the Phase 2 tables:

- preserves original values and known timestamps;
- labels assessment `legacy/unverified`;
- keeps lineage `(legacy_table, legacy_pk[, legacy_column])`;
- does not create `legal_entities`, `fetch_snapshots`, or `evidence`;
- does not set `map_precision` to `facility_exact`.

It is idempotent and does not rewrite public scoring tables.

## Phase 3 workflow tables (`0006_proposals_reviews_revisions.sql`)

- `proposals` — typed MCP submissions. Unique `idempotency_key`. `body_digest` is SHA-256 of the canonical body. Status: `pending_review`, `approved`, `rejected`, `changes_requested`. `actor_id` must be a canonical lowercase ASCII identifier (`^[a-z][a-z0-9_-]{0,63}$`).
- `revisions` — ordered body history for a proposal. Changing an approved proposal inserts a revision and returns status to `pending_review`. `actor_id` uses the same canonical principal rule.
- `proposal_reviews` — review decisions. `reviewer_id` uses the same canonical principal rule. A trigger rejects `approve` when `reviewer_id` equals `proposals.actor_id`. A later body change sets `invalidated_at` on prior approvals.

Publication receipts are not created in this phase.

## Later domains (not in Phase 3)

Publication receipts, methodology versions, scoring runs, trends, and outlooks remain future work.

## Sanitized acceptance corpus

Phase 0 fixtures in `tests/fixtures/` are fictional. They remain comparison evidence for the legacy engine, not expected behavior of the future scorer.
