-- 0008_scoring_runs.sql
-- Versioned methodology and offering/deployment scoring runs.
-- Does not rewrite public SOV/OSS/CONF columns.

CREATE TABLE IF NOT EXISTS methodology_versions (
  id TEXT PRIMARY KEY,
  algorithm_version TEXT NOT NULL,
  ruleset_hash TEXT NOT NULL CHECK (ruleset_hash ~ '^[0-9a-f]{64}$'),
  dimensions JSONB NOT NULL,
  weights JSONB NOT NULL,
  evidence_readiness JSONB NOT NULL,
  notes TEXT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scoring_runs (
  id TEXT PRIMARY KEY,
  methodology_id TEXT NOT NULL REFERENCES methodology_versions(id),
  algorithm_version TEXT NOT NULL,
  ruleset_hash TEXT NOT NULL CHECK (ruleset_hash ~ '^[0-9a-f]{64}$'),
  data_revision TEXT NOT NULL,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('offering', 'deployment', 'offering_deployment')),
  subject_id TEXT NOT NULL,
  offering_id TEXT,
  deployment_id TEXT,
  provider_id TEXT,
  recommendation_group TEXT NOT NULL CHECK (recommendation_group IN (
    'eligible', 'needs_verification', 'excluded'
  )),
  composite NUMERIC,
  ranking_lower_bound NUMERIC,
  uncertainty NUMERIC NOT NULL,
  reason_codes TEXT[] NOT NULL DEFAULT '{}',
  engine TEXT NOT NULL DEFAULT 'canonical' CHECK (engine IN ('canonical', 'legacy-fallback')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scoring_runs_subject ON scoring_runs (subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_scoring_runs_methodology ON scoring_runs (methodology_id, data_revision);

CREATE TABLE IF NOT EXISTS score_components (
  scoring_run_id TEXT NOT NULL REFERENCES scoring_runs(id) ON DELETE CASCADE,
  dimension TEXT NOT NULL,
  knowledge_state TEXT NOT NULL CHECK (knowledge_state IN (
    'present', 'confirmed_absent', 'unknown', 'not_applicable', 'conflicting'
  )),
  value NUMERIC,
  weight NUMERIC NOT NULL,
  uncertainty NUMERIC NOT NULL,
  reason_codes TEXT[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (scoring_run_id, dimension)
);

INSERT INTO methodology_versions (
  id, algorithm_version, ruleset_hash, dimensions, weights, evidence_readiness, notes, published_at
) VALUES (
  'asean-offering-deployment-v1',
  '1.0.0',
  'aac738a238205ce9967b448e2609bcc9d9c0b6de944783337d1b1bf6e5b79739',
  '[
    "primary_data_residency",
    "backup_residency",
    "metadata_control_plane_residency",
    "contracting_entity_legal_control",
    "administrative_access_key_control",
    "evidence_coverage",
    "evidence_quality",
    "open_technology_portability",
    "commercial_comparability"
  ]'::jsonb,
  '{
    "primary_data_residency": 15,
    "backup_residency": 10,
    "metadata_control_plane_residency": 10,
    "contracting_entity_legal_control": 15,
    "administrative_access_key_control": 10,
    "evidence_coverage": 10,
    "evidence_quality": 10,
    "open_technology_portability": 10,
    "commercial_comparability": 10
  }'::jsonb,
  '{
    "minCoverage": 0.5,
    "criticalDimensions": [
      "primary_data_residency",
      "backup_residency",
      "metadata_control_plane_residency",
      "contracting_entity_legal_control",
      "administrative_access_key_control",
      "evidence_coverage",
      "evidence_quality"
    ],
    "materialConflictClaimTypes": [
      "primary_residency",
      "backup_residency",
      "metadata_residency",
      "legal_entity",
      "facility",
      "technology",
      "price"
    ],
    "materialConflictShare": 0.5
  }'::jsonb,
  'Offering/deployment grain. Unknown is not zero. Hard constraints never relax. Evidence-readiness gates eligibility; ranking uses the uncertainty-adjusted lower bound.',
  '2026-09-09T00:00:00Z'
)
ON CONFLICT (id) DO NOTHING;
