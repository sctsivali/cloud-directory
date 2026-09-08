# ADR 0001: PostgreSQL remains the canonical system of record

- Status: Accepted
- Date: 2026-09-09
- Phase: 0 (decision recorded; no migration executed)

## Context

The directory already stores providers, packages, locations, buildings, stacks, sources, and updates in PostgreSQL. Later phases add claims, evidence, proposals, revisions, and scoring runs. Workers and MCP clients will need a single place that wins when caches, snapshots, and model output disagree.

## Decision

PostgreSQL remains the canonical store. Application caches, search indexes, MCP responses, and generated feeds are derived. AI output is never a system of record.

## Consequences

- Schema changes go through versioned migrations (Phase 1+), not one-off ingest SQL as the upgrade path. Phase 2 adds migrations 0002–0005 beside the public legacy tables. Phase 3 adds `0006_proposals_reviews_revisions.sql`. Phase 4 adds `0007_collection_pipeline.sql`. Phase 5 adds `0008_scoring_runs.sql`.
- Collectors persist receipts; they do not become a second canonical database.
- Production stays read-only for this program until a separately approved cutover.
- Phase 0 fixtures are files, not a second live database.
