-- 0005_claims_evidence_snapshots.sql
-- Immutable fetch snapshots, typed claims, evidence, and claim-evidence links.
-- observed_at has no default: replay/import time must not become observation time.

CREATE TABLE IF NOT EXISTS fetch_snapshots (
  id TEXT PRIMARY KEY,
  source_url TEXT NOT NULL,
  final_url TEXT,
  fetched_at TIMESTAMPTZ NOT NULL,
  http_status INTEGER,
  content_type TEXT,
  content_sha256 TEXT NOT NULL,
  body TEXT,
  byte_length INTEGER,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL CHECK (subject_type IN (
    'provider', 'legal_entity', 'service', 'offering', 'offering_version',
    'location', 'facility', 'deployment', 'technology', 'technology_deployment'
  )),
  subject_id TEXT NOT NULL,
  claim_type TEXT NOT NULL,
  value JSONB,
  knowledge_state TEXT NOT NULL CHECK (knowledge_state IN (
    'present', 'confirmed_absent', 'unknown', 'not_applicable', 'conflicting'
  )),
  assessment_state TEXT NOT NULL CHECK (assessment_state IN (
    'extracted', 'inferred', 'provider_asserted', 'editorially_reviewed',
    'independently_verified', 'rejected', 'legacy/unverified'
  )),
  observed_at TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_from TIMESTAMPTZ,
  valid_to TIMESTAMPTZ,
  superseded_by TEXT REFERENCES claims(id),
  legacy_table TEXT,
  legacy_pk TEXT,
  legacy_column TEXT,
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  CHECK (
    NOT (knowledge_state = 'unknown' AND assessment_state = 'independently_verified')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS claims_legacy_uidx
  ON claims (legacy_table, legacy_pk, legacy_column)
  WHERE legacy_table IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_claims_subject ON claims (subject_type, subject_id);

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT REFERENCES fetch_snapshots(id) ON DELETE RESTRICT,
  excerpt TEXT,
  note TEXT,
  observed_at TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expired_at TIMESTAMPTZ,
  assessment_state TEXT CHECK (assessment_state IN (
    'extracted', 'inferred', 'provider_asserted', 'editorially_reviewed',
    'independently_verified', 'rejected', 'legacy/unverified'
  ))
);

CREATE TABLE IF NOT EXISTS claim_evidence (
  claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  stance TEXT NOT NULL CHECK (stance IN ('supports', 'contradicts', 'neutral')),
  PRIMARY KEY (claim_id, evidence_id)
);

CREATE OR REPLACE FUNCTION forbid_fetch_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'fetch_snapshots are immutable';
END;
$$;

DROP TRIGGER IF EXISTS fetch_snapshots_immutable_upd ON fetch_snapshots;
CREATE TRIGGER fetch_snapshots_immutable_upd
  BEFORE UPDATE ON fetch_snapshots
  FOR EACH ROW
  EXECUTE PROCEDURE forbid_fetch_snapshot_mutation();

DROP TRIGGER IF EXISTS fetch_snapshots_immutable_del ON fetch_snapshots;
CREATE TRIGGER fetch_snapshots_immutable_del
  BEFORE DELETE ON fetch_snapshots
  FOR EACH ROW
  EXECUTE PROCEDURE forbid_fetch_snapshot_mutation();

CREATE OR REPLACE FUNCTION assert_excerpt_in_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  snap_body text;
  ex text;
  snap_id text;
BEGIN
  IF TG_TABLE_NAME = 'evidence' THEN
    snap_id := NEW.snapshot_id;
    ex := NEW.excerpt;
  ELSE
    SELECT e.snapshot_id, e.excerpt INTO snap_id, ex
    FROM evidence e
    WHERE e.id = NEW.evidence_id;
  END IF;
  IF snap_id IS NULL OR ex IS NULL OR btrim(ex) = '' THEN
    RETURN NEW;
  END IF;
  SELECT body INTO snap_body FROM fetch_snapshots WHERE id = snap_id;
  IF snap_body IS NULL OR position(ex in snap_body) = 0 THEN
    RAISE EXCEPTION 'quoted excerpt must exist in the referenced immutable snapshot';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS evidence_excerpt_matches_snapshot ON evidence;
CREATE TRIGGER evidence_excerpt_matches_snapshot
  BEFORE INSERT OR UPDATE ON evidence
  FOR EACH ROW
  EXECUTE PROCEDURE assert_excerpt_in_snapshot();

DROP TRIGGER IF EXISTS claim_evidence_excerpt_matches_snapshot ON claim_evidence;
CREATE TRIGGER claim_evidence_excerpt_matches_snapshot
  BEFORE INSERT OR UPDATE ON claim_evidence
  FOR EACH ROW
  EXECUTE PROCEDURE assert_excerpt_in_snapshot();
