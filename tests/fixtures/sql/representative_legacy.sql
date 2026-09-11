-- Representative pre-patch schema: schema.sql without ingest/map_plans column patches
-- or later workflow tables. Used only by upgrade tests.

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE providers (
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

CREATE TABLE locations (
  id          SERIAL PRIMARY KEY,
  city        TEXT NOT NULL,
  country     TEXT NOT NULL,
  lat         DOUBLE PRECISION,
  lng         DOUBLE PRECISION,
  UNIQUE (city, country)
);

CREATE TABLE provider_locations (
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  PRIMARY KEY (provider_id, location_id)
);

CREATE TABLE buildings (
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

CREATE TABLE provider_buildings (
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  building_id INTEGER NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  PRIMARY KEY (provider_id, building_id)
);

CREATE INDEX idx_buildings_listed ON buildings(listed);
CREATE INDEX idx_provider_buildings_building ON provider_buildings(building_id);

CREATE TABLE stacks (
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

CREATE TABLE sovereignty (
  provider_id        TEXT PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
  score              INTEGER,
  data_residency     TEXT,
  local_support      BOOLEAN,
  sea_strength       TEXT,
  notes              TEXT
);

CREATE TABLE tiers (
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

CREATE INDEX idx_tiers_provider ON tiers(provider_id);
CREATE INDEX idx_tiers_price ON tiers(price_usd_month);
CREATE INDEX idx_providers_asean ON providers(is_local_asean);

CREATE TABLE sources (
  id           SERIAL PRIMARY KEY,
  provider_id  TEXT REFERENCES providers(id) ON DELETE SET NULL,
  url          TEXT,
  scraped_at   TIMESTAMPTZ,
  status       TEXT
);

CREATE TABLE directory_updates (
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
CREATE INDEX idx_directory_updates_at ON directory_updates (occurred_at DESC);

INSERT INTO providers (id, name, hq_country, hq_city, origin, provider_type, is_local_asean, website, legal_country)
VALUES (
  'legacy-local',
  'Legacy Local Cloud',
  'Indonesia',
  'Jakarta',
  'local',
  'IaaS',
  TRUE,
  'https://legacy-local.example.test',
  'Indonesia'
);

INSERT INTO locations (city, country, lat, lng) VALUES ('Jakarta', 'Indonesia', -6.2, 106.8);
INSERT INTO provider_locations (provider_id, location_id)
SELECT 'legacy-local', id FROM locations WHERE city = 'Jakarta' AND country = 'Indonesia';

INSERT INTO buildings (name, city, country, listed, operator, source)
VALUES (
  'Legacy Hall',
  'Jakarta',
  'Indonesia',
  TRUE,
  'Legacy Operator',
  'https://legacy-local.example.test/dc'
);

INSERT INTO provider_buildings (provider_id, building_id)
SELECT 'legacy-local', id FROM buildings WHERE name = 'Legacy Hall';

INSERT INTO stacks (provider_id, hypervisor, source_url)
VALUES ('legacy-local', 'KVM', 'https://legacy-local.example.test');

INSERT INTO sovereignty (provider_id, score, data_residency, local_support)
VALUES ('legacy-local', 80, 'local', TRUE);

INSERT INTO tiers (
  id, provider_id, tier_name, vcpu, ram_gb, storage_gb, storage_type,
  price_native, currency, price_usd_month, billing_period, dc_city, dc_country, status
) VALUES (
  'legacy-local-small', 'legacy-local', 'Small', 2, 4, 40, 'NVMe',
  '80000 IDR', 'IDR', 5.00, 'monthly', 'Jakarta', 'Indonesia', 'OK'
);

INSERT INTO sources (provider_id, url, scraped_at, status)
VALUES ('legacy-local', 'https://legacy-local.example.test', '2024-01-15T00:00:00Z', 'OK');

INSERT INTO directory_updates (kind, provider_id, title_id, title_en, href, occurred_at)
VALUES (
  'discovered',
  'legacy-local',
  'Legacy Local Cloud masuk Guide',
  'Legacy Local Cloud added to the Guide',
  '/provider/legacy-local',
  '2024-01-15T00:00:00Z'
);
