-- 0003_locations_facilities_deployments.sql
-- Extends public locations with map precision (default undisclosed).
-- Facilities/deployments are new canonical tables. map_projections is derived.

ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS map_precision TEXT NOT NULL DEFAULT 'undisclosed';

ALTER TABLE locations DROP CONSTRAINT IF EXISTS locations_map_precision_check;
ALTER TABLE locations ADD CONSTRAINT locations_map_precision_check
  CHECK (map_precision IN ('facility_exact', 'campus', 'city_centroid', 'region_centroid', 'undisclosed'));

ALTER TABLE locations DROP CONSTRAINT IF EXISTS locations_facility_exact_coords_check;
ALTER TABLE locations ADD CONSTRAINT locations_facility_exact_coords_check
  CHECK (map_precision <> 'facility_exact' OR (lat IS NOT NULL AND lng IS NOT NULL));

CREATE TABLE IF NOT EXISTS facilities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  address TEXT,
  operator TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  map_precision TEXT NOT NULL DEFAULT 'undisclosed'
    CHECK (map_precision IN ('facility_exact', 'campus', 'city_centroid', 'region_centroid', 'undisclosed')),
  listed BOOLEAN,
  assessment_state TEXT NOT NULL DEFAULT 'legacy/unverified'
    CHECK (assessment_state IN (
      'extracted', 'inferred', 'provider_asserted', 'editorially_reviewed',
      'independently_verified', 'rejected', 'legacy/unverified'
    )),
  legacy_table TEXT,
  legacy_pk TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (map_precision <> 'facility_exact' OR (lat IS NOT NULL AND lng IS NOT NULL)),
  UNIQUE (legacy_table, legacy_pk)
);

CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  offering_id TEXT REFERENCES offerings(id) ON DELETE SET NULL,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  assessment_state TEXT NOT NULL DEFAULT 'legacy/unverified'
    CHECK (assessment_state IN (
      'extracted', 'inferred', 'provider_asserted', 'editorially_reviewed',
      'independently_verified', 'rejected', 'legacy/unverified'
    )),
  legacy_table TEXT,
  legacy_pk TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (location_id IS NOT NULL),
  UNIQUE (legacy_table, legacy_pk)
);

CREATE TABLE IF NOT EXISTS deployment_facilities (
  deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  facility_id TEXT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  PRIMARY KEY (deployment_id, facility_id)
);

CREATE INDEX IF NOT EXISTS idx_facilities_location ON facilities (location_id);
CREATE INDEX IF NOT EXISTS idx_deployments_provider ON deployments (provider_id);
CREATE INDEX IF NOT EXISTS idx_deployments_location ON deployments (location_id);

CREATE OR REPLACE VIEW map_projections AS
SELECT
  f.id AS facility_id,
  f.name,
  f.location_id,
  l.city,
  l.country,
  f.map_precision,
  CASE
    WHEN f.map_precision = 'facility_exact' AND f.lat IS NOT NULL AND f.lng IS NOT NULL
    THEN f.lat
    ELSE NULL
  END AS pin_lat,
  CASE
    WHEN f.map_precision = 'facility_exact' AND f.lat IS NOT NULL AND f.lng IS NOT NULL
    THEN f.lng
    ELSE NULL
  END AS pin_lng,
  (f.map_precision = 'facility_exact' AND f.lat IS NOT NULL AND f.lng IS NOT NULL) AS is_exact_pin
FROM facilities f
LEFT JOIN locations l ON l.id = f.location_id;
