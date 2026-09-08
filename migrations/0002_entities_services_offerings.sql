-- 0002_entities_services_offerings.sql
-- Canonical identity and catalog. Public providers/tiers tables are not rewritten.

CREATE TABLE IF NOT EXISTS legal_entities (
  id TEXT PRIMARY KEY,
  legal_name TEXT NOT NULL,
  jurisdiction_country TEXT,
  registration_number TEXT,
  entity_kind TEXT,
  legacy_table TEXT,
  legacy_pk TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (legacy_table, legacy_pk)
);

CREATE TABLE IF NOT EXISTS provider_entity_relationships (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  legal_entity_id TEXT NOT NULL REFERENCES legal_entities(id) ON DELETE CASCADE,
  relationship_kind TEXT NOT NULL
    CHECK (relationship_kind IN ('brand', 'operator', 'contracting', 'parent', 'subsidiary', 'unknown')),
  valid_from TIMESTAMPTZ,
  valid_to TIMESTAMPTZ,
  assessment_state TEXT NOT NULL DEFAULT 'legacy/unverified'
    CHECK (assessment_state IN (
      'extracted', 'inferred', 'provider_asserted', 'editorially_reviewed',
      'independently_verified', 'rejected', 'legacy/unverified'
    )),
  legacy_table TEXT,
  legacy_pk TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  UNIQUE (provider_id, legal_entity_id, relationship_kind)
);

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  assessment_state TEXT NOT NULL DEFAULT 'legacy/unverified'
    CHECK (assessment_state IN (
      'extracted', 'inferred', 'provider_asserted', 'editorially_reviewed',
      'independently_verified', 'rejected', 'legacy/unverified'
    )),
  legacy_table TEXT,
  legacy_pk TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_id, slug),
  UNIQUE (legacy_table, legacy_pk)
);

CREATE TABLE IF NOT EXISTS offerings (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT,
  assessment_state TEXT NOT NULL DEFAULT 'legacy/unverified'
    CHECK (assessment_state IN (
      'extracted', 'inferred', 'provider_asserted', 'editorially_reviewed',
      'independently_verified', 'rejected', 'legacy/unverified'
    )),
  legacy_table TEXT,
  legacy_pk TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (legacy_table, legacy_pk)
);

CREATE TABLE IF NOT EXISTS offering_versions (
  id TEXT PRIMARY KEY,
  offering_id TEXT NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  version_ordinal INTEGER NOT NULL CHECK (version_ordinal >= 1),
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  observed_at TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_from TIMESTAMPTZ,
  valid_to TIMESTAMPTZ,
  assessment_state TEXT NOT NULL DEFAULT 'legacy/unverified'
    CHECK (assessment_state IN (
      'extracted', 'inferred', 'provider_asserted', 'editorially_reviewed',
      'independently_verified', 'rejected', 'legacy/unverified'
    )),
  legacy_table TEXT,
  legacy_pk TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  UNIQUE (offering_id, version_ordinal),
  UNIQUE (legacy_table, legacy_pk)
);

CREATE INDEX IF NOT EXISTS idx_offerings_provider ON offerings (provider_id);
CREATE INDEX IF NOT EXISTS idx_services_provider ON services (provider_id);
CREATE INDEX IF NOT EXISTS idx_offering_versions_offering ON offering_versions (offering_id);
