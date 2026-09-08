-- 0001_legacy_baseline.sql
-- Canonical current schema, assembled from:
--   schema.sql
--   scripts/map_plans.sql (tier column patches)
--   data/ingest/buildings_hall_check.sql
--   data/ingest/building_facts_20260830.sql
--   data/ingest/provider_pipeline.sql
--   data/ingest/correction_requests.sql
--   data/seed-directory-updates.sql (CREATE TABLE only)
-- Data DML from ingest/seed files is not part of this migration.
-- Schema-changing SQL outside migrations/ is deprecated.

CREATE EXTENSION IF NOT EXISTS citext;

-- schema.sql
CREATE TABLE IF NOT EXISTS providers (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  hq_country      TEXT,
  hq_city         TEXT,
  origin          TEXT CHECK (origin IN ('local', 'regional', 'global', 'unknown')),
  provider_type   TEXT,
  is_local_asean  BOOLEAN NOT NULL DEFAULT FALSE,
  website         TEXT,
  notes           TEXT,
  legal_country   TEXT,
  legal_note      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS locations (
  id          SERIAL PRIMARY KEY,
  city        TEXT NOT NULL,
  country     TEXT NOT NULL,
  lat         DOUBLE PRECISION,
  lng         DOUBLE PRECISION,
  UNIQUE (city, country)
);

CREATE TABLE IF NOT EXISTS provider_locations (
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  PRIMARY KEY (provider_id, location_id)
);

CREATE TABLE IF NOT EXISTS buildings (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  city        TEXT NOT NULL,
  country     TEXT NOT NULL,
  source      TEXT,
  listed      BOOLEAN NOT NULL DEFAULT FALSE,
  address     TEXT,
  operator    TEXT,
  lat         DOUBLE PRECISION,
  lng         DOUBLE PRECISION,
  photo_path   TEXT,
  photo_credit TEXT,
  photo_source TEXT,
  UNIQUE (name, city, country)
);

CREATE TABLE IF NOT EXISTS provider_buildings (
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  building_id INTEGER NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  PRIMARY KEY (provider_id, building_id)
);

CREATE INDEX IF NOT EXISTS idx_buildings_listed ON buildings(listed);
CREATE INDEX IF NOT EXISTS idx_provider_buildings_building ON provider_buildings(building_id);

CREATE TABLE IF NOT EXISTS stacks (
  provider_id            TEXT PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
  hypervisor             TEXT,
  container_runtime      TEXT,
  orchestration          TEXT,
  storage                TEXT,
  network                TEXT,
  control_plane          TEXT,
  virtualization         TEXT,
  open_source            BOOLEAN,
  open_source_score      INTEGER,
  open_source_grade      TEXT,
  source_url             TEXT
);

CREATE TABLE IF NOT EXISTS sovereignty (
  provider_id        TEXT PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
  score              INTEGER,
  data_residency     TEXT,
  local_support      BOOLEAN,
  sea_strength       TEXT,
  notes              TEXT
);

CREATE TABLE IF NOT EXISTS tiers (
  id                   TEXT PRIMARY KEY,
  provider_id          TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  tier_name            TEXT NOT NULL,
  vcpu                 INTEGER,
  cpu_type             TEXT,
  cpu_family           TEXT,
  ram_gb               NUMERIC,
  storage_gb           NUMERIC,
  storage_type         TEXT,
  gpu                  TEXT,
  gpu_count            INTEGER,
  gpu_memory_gb        NUMERIC,
  bandwidth            TEXT,
  ipv4                 INTEGER,
  ipv6                 BOOLEAN,
  price_native         TEXT,
  currency             TEXT,
  price_usd_month      NUMERIC NOT NULL,
  billing_period       TEXT NOT NULL DEFAULT 'monthly',
  dc_location          TEXT,
  dc_city              TEXT,
  dc_country           TEXT,
  hypervisor           TEXT,
  orchestration        TEXT,
  container_runtime    TEXT,
  stack_storage        TEXT,
  sov_score            INTEGER,
  oss_score            INTEGER,
  status               TEXT NOT NULL DEFAULT 'OK' CHECK (status IN ('OK', '-', 'RS')),
  raw                  JSONB,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tiers_provider ON tiers(provider_id);
CREATE INDEX IF NOT EXISTS idx_tiers_price ON tiers(price_usd_month);
CREATE INDEX IF NOT EXISTS idx_providers_asean ON providers(is_local_asean);

CREATE TABLE IF NOT EXISTS sources (
  id           SERIAL PRIMARY KEY,
  provider_id  TEXT REFERENCES providers(id) ON DELETE SET NULL,
  url          TEXT,
  scraped_at   TIMESTAMPTZ,
  status       TEXT
);

CREATE TABLE IF NOT EXISTS directory_updates (
  id           SERIAL PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('discovered', 'updated')),
  provider_id  TEXT REFERENCES providers(id) ON DELETE SET NULL,
  title_id     TEXT NOT NULL,
  title_en     TEXT NOT NULL,
  summary_id   TEXT,
  summary_en   TEXT,
  href         TEXT,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_directory_updates_at ON directory_updates (occurred_at DESC);

-- scripts/map_plans.sql (idempotent for databases created before those columns)
ALTER TABLE tiers ADD COLUMN IF NOT EXISTS dc_location TEXT;
ALTER TABLE tiers ADD COLUMN IF NOT EXISTS dc_city TEXT;
ALTER TABLE tiers ADD COLUMN IF NOT EXISTS dc_country TEXT;
ALTER TABLE tiers ADD COLUMN IF NOT EXISTS sov_score INTEGER;
ALTER TABLE tiers ADD COLUMN IF NOT EXISTS oss_score INTEGER;

-- data/ingest/buildings_hall_check.sql
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS facilities text;
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS last_checked_at timestamptz;
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS check_source text;

-- data/ingest/building_facts_20260830.sql
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS operator_country text;
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS dc_tier text;
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS telcos text;
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS dc_tech text;

-- data/ingest/provider_pipeline.sql
CREATE TABLE IF NOT EXISTS provider_pipeline (
  id serial PRIMARY KEY,
  name text NOT NULL,
  website text,
  country text,
  status text NOT NULL DEFAULT 'discovered'
    CHECK (status IN ('discovered','queued','crawling','needs_review','ingested','rejected')),
  reason text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS provider_pipeline_website_uidx
  ON provider_pipeline (lower(website))
  WHERE website IS NOT NULL AND website <> '';
CREATE INDEX IF NOT EXISTS provider_pipeline_status_idx
  ON provider_pipeline (status, updated_at DESC);

-- data/ingest/correction_requests.sql
CREATE TABLE IF NOT EXISTS correction_requests (
  id serial PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('rescan','claim')),
  provider_id text NOT NULL REFERENCES providers(id),
  requester_email text,
  token text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','notified','approved','verified','expired','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz
);
CREATE INDEX IF NOT EXISTS correction_requests_provider_created
  ON correction_requests (kind, provider_id, created_at DESC);

CREATE TABLE IF NOT EXISTS provider_claims (
  provider_id text PRIMARY KEY REFERENCES providers(id),
  email text NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now()
);
