-- L11: append-only collection submission outcomes. Ambiguous is terminal.
-- Rejected/ambiguous/zero/incomplete required submissions cannot move a task to proposed.
-- Exact (task_id, tool_name, idempotency_key, request_digest) identity is mandatory.

ALTER TABLE collection_tasks DROP CONSTRAINT IF EXISTS collection_tasks_status_check;
ALTER TABLE collection_tasks ADD CONSTRAINT collection_tasks_status_check
  CHECK (status IN (
    'queued', 'leased', 'fetched', 'extracted', 'verified', 'proposed', 'failed',
    'needs_review', 'ambiguous'
  ));

ALTER TABLE collection_tasks
  ADD COLUMN IF NOT EXISTS required_submission_count INTEGER
  CHECK (
    required_submission_count IS NULL
    OR (required_submission_count >= 0 AND required_submission_count <= 64)
  );

CREATE TABLE IF NOT EXISTS collection_submission_outcomes (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES collection_tasks(id) ON DELETE RESTRICT,
  tool_name TEXT NOT NULL CHECK (tool_name IN (
    'directory.propose_claim',
    'directory.propose_offering',
    'directory.propose_price_observation',
    'directory.propose_location',
    'directory.propose_facility',
    'directory.propose_technology_deployment',
    'directory.propose_retraction'
  )),
  idempotency_key TEXT NOT NULL UNIQUE,
  request_digest TEXT NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  outcome TEXT NOT NULL CHECK (outcome IN ('created', 'replayed', 'rejected', 'ambiguous')),
  proposal_id TEXT,
  reason_codes TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT collection_submission_outcomes_reason_bounds CHECK (
    cardinality(reason_codes) <= 16
    AND reason_codes <@ ARRAY[
      'excerpt_missing',
      'subject_mismatch',
      'negated_kvm',
      'hedged_statement',
      'excerpt_mismatch',
      'office_not_facility',
      'non_official_source',
      'stale_evidence',
      'ai_disagreement',
      'independently_verified_unjustified',
      'malformed_payload',
      'idempotency_conflict',
      'tool_unavailable',
      'commit_uncertain',
      'digest_conflict',
      'mcp_rejected'
    ]::text[]
  )
);

CREATE INDEX IF NOT EXISTS idx_collection_submission_outcomes_task
  ON collection_submission_outcomes (task_id);

CREATE OR REPLACE FUNCTION forbid_collection_submission_outcome_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'collection_submission_outcomes are append-only';
END;
$$;

DROP TRIGGER IF EXISTS collection_submission_outcomes_immutable_upd ON collection_submission_outcomes;
CREATE TRIGGER collection_submission_outcomes_immutable_upd
  BEFORE UPDATE ON collection_submission_outcomes
  FOR EACH ROW
  EXECUTE PROCEDURE forbid_collection_submission_outcome_mutation();

DROP TRIGGER IF EXISTS collection_submission_outcomes_immutable_del ON collection_submission_outcomes;
CREATE TRIGGER collection_submission_outcomes_immutable_del
  BEFORE DELETE ON collection_submission_outcomes
  FOR EACH ROW
  EXECUTE PROCEDURE forbid_collection_submission_outcome_mutation();

CREATE OR REPLACE FUNCTION preserve_required_submission_count()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.required_submission_count IS NOT NULL
     AND NEW.required_submission_count IS DISTINCT FROM OLD.required_submission_count THEN
    RAISE EXCEPTION 'required_submission_count is immutable once set';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS collection_tasks_required_count_immutable ON collection_tasks;
CREATE TRIGGER collection_tasks_required_count_immutable
  BEFORE UPDATE ON collection_tasks
  FOR EACH ROW
  EXECUTE PROCEDURE preserve_required_submission_count();

CREATE OR REPLACE FUNCTION collection_task_proposed_requires_successful_submissions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  success_count integer;
BEGIN
  IF NEW.status = 'proposed' THEN
    IF NEW.required_submission_count IS NULL OR NEW.required_submission_count < 1 THEN
      RAISE EXCEPTION 'zero or missing required submissions prevent proposed';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM collection_submission_outcomes
      WHERE task_id = NEW.id
        AND outcome IN ('rejected', 'ambiguous')
    ) THEN
      RAISE EXCEPTION 'rejected or ambiguous required submissions prevent proposed';
    END IF;
    SELECT count(DISTINCT idempotency_key) INTO success_count
    FROM collection_submission_outcomes
    WHERE task_id = NEW.id
      AND outcome IN ('created', 'replayed');
    IF success_count IS DISTINCT FROM NEW.required_submission_count THEN
      RAISE EXCEPTION 'incomplete required submissions prevent proposed';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS collection_tasks_proposed_gate ON collection_tasks;
CREATE TRIGGER collection_tasks_proposed_gate
  BEFORE INSERT OR UPDATE ON collection_tasks
  FOR EACH ROW
  EXECUTE PROCEDURE collection_task_proposed_requires_successful_submissions();
