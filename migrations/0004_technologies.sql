-- 0004_technologies.sql
-- Technology catalog, versions, and scoped deployments.
-- Inheritance onto offerings requires has_universal_scope_evidence = TRUE.

CREATE TABLE IF NOT EXISTS technologies (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS technology_versions (
  id TEXT PRIMARY KEY,
  technology_id TEXT NOT NULL REFERENCES technologies(id) ON DELETE CASCADE,
  version_label TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (technology_id, version_label)
);

CREATE TABLE IF NOT EXISTS technology_deployments (
  id TEXT PRIMARY KEY,
  technology_id TEXT NOT NULL REFERENCES technologies(id) ON DELETE CASCADE,
  technology_version_id TEXT REFERENCES technology_versions(id) ON DELETE SET NULL,
  scope TEXT NOT NULL CHECK (scope IN ('provider', 'service', 'offering', 'deployment')),
  scope_id TEXT NOT NULL,
  has_universal_scope_evidence BOOLEAN NOT NULL DEFAULT FALSE,
  assessment_state TEXT NOT NULL DEFAULT 'legacy/unverified'
    CHECK (assessment_state IN (
      'extracted', 'inferred', 'provider_asserted', 'editorially_reviewed',
      'independently_verified', 'rejected', 'legacy/unverified'
    )),
  legacy_table TEXT,
  legacy_pk TEXT,
  legacy_column TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (legacy_table, legacy_pk, legacy_column)
);

CREATE INDEX IF NOT EXISTS idx_technology_deployments_scope ON technology_deployments (scope, scope_id);
CREATE INDEX IF NOT EXISTS idx_technology_versions_tech ON technology_versions (technology_id);
