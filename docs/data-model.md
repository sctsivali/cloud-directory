# Data model

Status: Phase 0 baseline of the tables in `schema.sql`. Target domains are named so later migrations have a vocabulary. No migration is authorized by this document.

## Current tables

### Identity

`providers` is the only identity grain. Fields mix brand, headquarters, legal home, origin (`local` / `regional` / `global` / `unknown`), and `is_local_asean`. There is no legal-entity table and no provider–entity relationship history.

### Catalog and price

`tiers` stores public packages on a provider. Price is a single `price_usd_month` plus optional native amount and currency. Billing period, promo, commitment, tax, and FX observation are not first-class. Ingest (`scripts/ingest_provider.py`) converts unknown currencies with the IDR fallback rate.

### Geography

`locations` and `provider_locations` record city/country pairs. `buildings` and `provider_buildings` record named halls. `listed` is the only precision flag. City-only disclosure and exact facility pins are not distinct types. Map coordinates can be attached to a building even when the public source only named a city.

### Technology

`stacks` is one row per provider. Hypervisor, orchestration, storage, runtime, and control plane are free text. There is no technology catalog, version, or deployment scope. A provider-level string is treated as if it applies to every package.

### Evidence and time

`sources` is a URL list with `scraped_at` and `status`. There is no immutable fetch snapshot, excerpt, claim, or observation time distinct from ingest time. A non-empty URL is enough for the confidence score.

### Transparency

`directory_updates` is a hand-written or script-inserted feed. It is not a revision ledger.

`sovereignty` stores editorial residency labels used in display, not in the numeric SOV formula.

## Target domains (future)

See the implementation plan. Identity splits into providers, legal entities, and relationships. Catalog splits into services, offerings, offering versions, and price observations. Geography splits into locations, facilities, deployments, and derived map projections with an explicit precision enum. Technology becomes a catalog plus scoped deployments. Evidence becomes sources, fetch snapshots, claims, and claim–evidence links with knowledge and assessment states. Workflow becomes proposals, reviews, revisions, and publication receipts. Analytics becomes methodology versions, scoring runs, trends, and outlooks.

## Knowledge and assessment (target enums)

Knowledge state: `present`, `confirmed_absent`, `unknown`, `not_applicable`, `conflicting`.

Assessment state: `extracted`, `inferred`, `provider_asserted`, `editorially_reviewed`, `independently_verified`, `rejected`.

The current schema cannot represent these states. Empty fields and failed fetches are not `unknown`; they are usually scored as zero.

## Sanitized acceptance corpus

Phase 0 fixtures in `tests/fixtures/` are fictional. They cover the provider, source, technology, pricing, and geography cases required to reproduce known defects. They are immutable comparison evidence, not a production extract.
