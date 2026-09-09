-- 0010_trend_series_outlook.sql
-- Versioned trend series, ISO country registry, and outlook contract tables.
-- Trends derive only from verified published revisions. Forecasts are not
-- auto-published; eligibility is metric-specific and never elapsed-days-only.

CREATE TABLE IF NOT EXISTS country_registry (
  iso2 TEXT PRIMARY KEY CHECK (iso2 ~ '^[A-Z]{2}$'),
  name_en TEXT NOT NULL,
  name_id TEXT NOT NULL,
  asean BOOLEAN NOT NULL DEFAULT false,
  aliases JSONB NOT NULL DEFAULT '[]'::jsonb
);

INSERT INTO country_registry (iso2, name_en, name_id, asean, aliases) VALUES
  ('BN', 'Brunei', 'Brunei', true, '["Brunei Darussalam","Nation of Brunei"]'::jsonb),
  ('KH', 'Cambodia', 'Kamboja', true, '["Kampuchea"]'::jsonb),
  ('ID', 'Indonesia', 'Indonesia', true, '["Republic of Indonesia","RI"]'::jsonb),
  ('LA', 'Laos', 'Laos', true, '["Lao PDR","Lao People''s Democratic Republic"]'::jsonb),
  ('MY', 'Malaysia', 'Malaysia', true, '[]'::jsonb),
  ('MM', 'Myanmar', 'Myanmar', true, '["Burma"]'::jsonb),
  ('PH', 'Philippines', 'Filipina', true, '["The Philippines"]'::jsonb),
  ('SG', 'Singapore', 'Singapura', true, '["Republic of Singapore"]'::jsonb),
  ('TH', 'Thailand', 'Thailand', true, '["Kingdom of Thailand"]'::jsonb),
  ('VN', 'Vietnam', 'Vietnam', true, '["Viet Nam","Socialist Republic of Vietnam"]'::jsonb),
  ('TL', 'Timor-Leste', 'Timor Leste', false, '["East Timor"]'::jsonb),
  ('US', 'United States', 'Amerika Serikat', false, '["USA","United States of America"]'::jsonb),
  ('CN', 'China', 'Tiongkok', false, '["PRC","People''s Republic of China"]'::jsonb),
  ('GB', 'United Kingdom', 'Britania Raya', false, '["UK","Great Britain"]'::jsonb),
  ('IN', 'India', 'India', false, '[]'::jsonb),
  ('AT', 'Austria', 'Austria', false, '[]'::jsonb),
  ('IL', 'Israel', 'Israel', false, '[]'::jsonb)
ON CONFLICT (iso2) DO NOTHING;

CREATE TABLE IF NOT EXISTS trend_series (
  id TEXT PRIMARY KEY,
  metric TEXT NOT NULL CHECK (metric IN (
    'provider_count_by_country',
    'offering_count_by_country',
    'comparable_basket_price_index',
    'region_facility_expansion',
    'technology_adoption',
    'evidence_coverage',
    'evidence_freshness',
    'concentration',
    'verified_additions',
    'verified_retractions',
    'verified_conflicts'
  )),
  country_iso2 TEXT REFERENCES country_registry(iso2),
  provider_id TEXT,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  value DOUBLE PRECISION,
  observation_count INTEGER NOT NULL CHECK (observation_count >= 0),
  comparable_population INTEGER NOT NULL CHECK (comparable_population >= 0),
  missingness DOUBLE PRECISION NOT NULL CHECK (missingness >= 0 AND missingness <= 1),
  continuity DOUBLE PRECISION NOT NULL CHECK (continuity >= 0 AND continuity <= 1),
  revision_quality DOUBLE PRECISION NOT NULL CHECK (revision_quality >= 0 AND revision_quality <= 1),
  source_revision_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  methodology_version TEXT NOT NULL,
  methodology_hash TEXT NOT NULL CHECK (methodology_hash ~ '^[0-9a-f]{64}$'),
  data_revision TEXT NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT trend_series_identity UNIQUE NULLS NOT DISTINCT (metric, country_iso2, provider_id, period_start, period_end, data_revision, methodology_version)
);

CREATE INDEX IF NOT EXISTS idx_trend_series_metric_period ON trend_series (metric, period_start);
CREATE INDEX IF NOT EXISTS idx_trend_series_country ON trend_series (country_iso2, metric);

CREATE TABLE IF NOT EXISTS outlook_assessments (
  id TEXT PRIMARY KEY,
  metric TEXT NOT NULL,
  country_iso2 TEXT REFERENCES country_registry(iso2),
  provider_id TEXT,
  observation_window_start TIMESTAMPTZ NOT NULL,
  observation_window_end TIMESTAMPTZ NOT NULL,
  baseline JSONB,
  observed_fact JSONB NOT NULL,
  measured_trend JSONB NOT NULL,
  signal JSONB NOT NULL,
  assessment JSONB NOT NULL,
  forecast JSONB,
  supporting_indicators JSONB NOT NULL DEFAULT '[]'::jsonb,
  contradicting_indicators JSONB NOT NULL DEFAULT '[]'::jsonb,
  assumptions JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence_label TEXT NOT NULL CHECK (confidence_label IN ('insufficient', 'low', 'medium', 'high')),
  confidence_low DOUBLE PRECISION,
  confidence_high DOUBLE PRECISION,
  model_version TEXT NOT NULL,
  ruleset_version TEXT NOT NULL,
  ruleset_hash TEXT NOT NULL CHECK (ruleset_hash ~ '^[0-9a-f]{64}$'),
  data_revision TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  eligibility_passed BOOLEAN NOT NULL,
  failed_gates JSONB NOT NULL DEFAULT '[]'::jsonb,
  publication_state TEXT NOT NULL CHECK (publication_state IN (
    'not_published', 'insufficient_evidence', 'ineligible'
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((forecast IS NULL) OR eligibility_passed),
  CHECK (jsonb_typeof(observed_fact) = 'object' AND observed_fact->>'layer' = 'observed_fact'),
  CHECK (jsonb_typeof(measured_trend) = 'object' AND measured_trend->>'layer' = 'measured_trend'),
  CHECK (jsonb_typeof(signal) = 'object' AND signal->>'layer' = 'signal'),
  CHECK (jsonb_typeof(assessment) = 'object' AND assessment->>'layer' = 'assessment'),
  CHECK (forecast IS NULL OR (jsonb_typeof(forecast) = 'object' AND forecast->>'layer' = 'forecast')),
  CHECK ((confidence_low IS NULL) = (confidence_high IS NULL)),
  CHECK (confidence_low IS NULL OR confidence_low <= confidence_high),
  CHECK ((forecast IS NULL) = (confidence_low IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_outlook_assessments_metric ON outlook_assessments (metric, country_iso2);

CREATE TABLE IF NOT EXISTS outlook_backtests (
  id TEXT PRIMARY KEY,
  outlook_id TEXT REFERENCES outlook_assessments(id),
  metric TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('not_run', 'pass', 'fail', 'insufficient')),
  hit_rate DOUBLE PRECISION,
  sample_count INTEGER NOT NULL CHECK (sample_count >= 0),
  ruleset_hash TEXT NOT NULL CHECK (ruleset_hash ~ '^[0-9a-f]{64}$'),
  data_revision TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE VIEW verified_trend_facts AS
SELECT
  r.id AS receipt_id,
  r.revision_id,
  r.change_type,
  r.entity_type,
  r.entity_id,
  r.field_name,
  r.before_value,
  r.after_value,
  r.verification_state,
  r.methodology_version,
  r.data_revision,
  r.published_at,
  r.supersedes_receipt_id,
  e.observed_at,
  e.provider_id,
  e.id AS event_id
FROM publication_receipts r
JOIN change_events e ON e.receipt_id = r.id
WHERE r.verification_state = 'verified';

CREATE OR REPLACE FUNCTION forbid_outlook_forecast_without_eligibility()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.forecast IS NOT NULL AND NEW.eligibility_passed IS NOT TRUE THEN
    RAISE EXCEPTION 'forecast cannot be stored when eligibility gates fail';
  END IF;
  IF NEW.publication_state = 'insufficient_evidence' AND NEW.forecast IS NOT NULL THEN
    RAISE EXCEPTION 'insufficient evidence outlook cannot store a forecast';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_forbid_outlook_forecast_without_eligibility ON outlook_assessments;
CREATE TRIGGER trg_forbid_outlook_forecast_without_eligibility
BEFORE INSERT OR UPDATE ON outlook_assessments
FOR EACH ROW EXECUTE FUNCTION forbid_outlook_forecast_without_eligibility();
