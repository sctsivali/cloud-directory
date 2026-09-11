-- 0009_publication_ledger.sql
-- Append-only publication receipts, canonical-state CAS, and public change events.

ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_status_check;
ALTER TABLE proposals ADD CONSTRAINT proposals_status_check
  CHECK (status IN (
    'pending_review', 'approved', 'rejected', 'changes_requested', 'published'
  ));

ALTER TABLE proposal_reviews
  ADD COLUMN IF NOT EXISTS bound_revision_id TEXT,
  ADD COLUMN IF NOT EXISTS bound_body_digest TEXT
    CHECK (bound_body_digest IS NULL OR bound_body_digest ~ '^[0-9a-f]{64}$');

CREATE TABLE IF NOT EXISTS canonical_states (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  field_name TEXT NOT NULL,
  value JSONB,
  value_digest TEXT NOT NULL CHECK (value_digest ~ '^[0-9a-f]{64}$'),
  data_revision TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, entity_id, field_name)
);

CREATE TABLE IF NOT EXISTS publication_attempts (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_digest TEXT NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  proposal_id TEXT NOT NULL REFERENCES proposals(id),
  revision_id TEXT NOT NULL,
  publisher_id TEXT NOT NULL CHECK (publisher_id ~ '^[a-z][a-z0-9_-]{0,63}$'),
  state TEXT NOT NULL CHECK (state IN (
    'pending', 'committed', 'uncertain', 'reconciled_committed', 'reconciled_absent'
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS publication_receipts (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES publication_attempts(id),
  proposal_id TEXT NOT NULL REFERENCES proposals(id),
  revision_id TEXT NOT NULL,
  revision_ordinal INTEGER NOT NULL,
  body_digest TEXT NOT NULL CHECK (body_digest ~ '^[0-9a-f]{64}$'),
  approval_id TEXT NOT NULL,
  approval_digest TEXT NOT NULL CHECK (approval_digest ~ '^[0-9a-f]{64}$'),
  reviewer_id TEXT NOT NULL CHECK (reviewer_id ~ '^[a-z][a-z0-9_-]{0,63}$'),
  publisher_id TEXT NOT NULL CHECK (publisher_id ~ '^[a-z][a-z0-9_-]{0,63}$'),
  methodology_version TEXT NOT NULL,
  data_revision TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  evidence_snapshot_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  before_value JSONB,
  after_value JSONB,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  field_name TEXT NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN (
    'create', 'update', 'retract', 'rollback', 'correction'
  )),
  verification_state TEXT NOT NULL DEFAULT 'pending' CHECK (verification_state IN (
    'pending', 'verified', 'failed', 'uncertain', 'rolled_back'
  )),
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  supersedes_receipt_id TEXT REFERENCES publication_receipts(id),
  verified_by TEXT CHECK (verified_by IS NULL OR verified_by ~ '^[a-z][a-z0-9_-]{0,63}$'),
  verified_at TIMESTAMPTZ,
  UNIQUE (proposal_id, revision_id)
);

CREATE INDEX IF NOT EXISTS idx_publication_receipts_proposal ON publication_receipts (proposal_id);

CREATE TABLE IF NOT EXISTS change_events (
  id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL REFERENCES publication_receipts(id),
  revision_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN (
    'create', 'update', 'retract', 'rollback', 'correction'
  )),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  field_name TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  value_sensitivity TEXT NOT NULL DEFAULT 'public'
    CHECK (value_sensitivity IN ('public', 'redacted')),
  source_id TEXT,
  evidence_snapshot_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  detected_at TIMESTAMPTZ,
  observed_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ NOT NULL,
  correction_of_event_id TEXT REFERENCES change_events(id),
  title_id TEXT NOT NULL,
  title_en TEXT NOT NULL,
  summary_id TEXT,
  summary_en TEXT,
  provider_id TEXT,
  href TEXT
);

CREATE INDEX IF NOT EXISTS idx_change_events_published ON change_events (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_change_events_revision ON change_events (revision_id);

CREATE OR REPLACE FUNCTION forbid_proposal_self_publish()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  proposer text;
BEGIN
  SELECT actor_id INTO proposer FROM proposals WHERE id = NEW.proposal_id;
  IF proposer IS NOT NULL AND proposer = NEW.publisher_id THEN
    RAISE EXCEPTION 'proposal author cannot publish own proposal';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS publication_receipts_no_self_publish ON publication_receipts;
CREATE TRIGGER publication_receipts_no_self_publish
  BEFORE INSERT OR UPDATE ON publication_receipts
  FOR EACH ROW
  EXECUTE PROCEDURE forbid_proposal_self_publish();

CREATE OR REPLACE FUNCTION publication_attempt_state_allowed(old_state text, new_state text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE old_state
    WHEN 'pending' THEN new_state IN ('pending', 'committed', 'uncertain')
    WHEN 'uncertain' THEN new_state IN ('uncertain', 'committed', 'reconciled_committed', 'reconciled_absent')
    WHEN 'committed' THEN new_state IN ('committed', 'reconciled_committed')
    WHEN 'reconciled_committed' THEN new_state = 'reconciled_committed'
    WHEN 'reconciled_absent' THEN new_state = 'reconciled_absent'
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION protect_publication_attempt_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.request_digest IS DISTINCT FROM OLD.request_digest
       OR NEW.proposal_id IS DISTINCT FROM OLD.proposal_id
       OR NEW.revision_id IS DISTINCT FROM OLD.revision_id
       OR NEW.publisher_id IS DISTINCT FROM OLD.publisher_id
       OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
       OR NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'publication attempt identity is immutable';
    END IF;
    IF NOT publication_attempt_state_allowed(OLD.state, NEW.state) THEN
      RAISE EXCEPTION 'publication attempt state cannot regress';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS publication_attempts_protect ON publication_attempts;
CREATE TRIGGER publication_attempts_protect
  BEFORE UPDATE ON publication_attempts
  FOR EACH ROW
  EXECUTE PROCEDURE protect_publication_attempt_integrity();

CREATE OR REPLACE FUNCTION publication_verification_state_allowed(old_state text, new_state text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE old_state
    WHEN 'pending' THEN new_state IN ('pending', 'verified', 'failed', 'uncertain', 'rolled_back')
    WHEN 'verified' THEN new_state IN ('verified', 'rolled_back')
    WHEN 'failed' THEN new_state = 'failed'
    WHEN 'uncertain' THEN new_state IN ('uncertain', 'verified', 'failed')
    WHEN 'rolled_back' THEN new_state = 'rolled_back'
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION protect_publication_receipt_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.attempt_id IS DISTINCT FROM OLD.attempt_id
       OR NEW.proposal_id IS DISTINCT FROM OLD.proposal_id
       OR NEW.revision_id IS DISTINCT FROM OLD.revision_id
       OR NEW.revision_ordinal IS DISTINCT FROM OLD.revision_ordinal
       OR NEW.body_digest IS DISTINCT FROM OLD.body_digest
       OR NEW.approval_id IS DISTINCT FROM OLD.approval_id
       OR NEW.approval_digest IS DISTINCT FROM OLD.approval_digest
       OR NEW.reviewer_id IS DISTINCT FROM OLD.reviewer_id
       OR NEW.publisher_id IS DISTINCT FROM OLD.publisher_id
       OR NEW.methodology_version IS DISTINCT FROM OLD.methodology_version
       OR NEW.data_revision IS DISTINCT FROM OLD.data_revision
       OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
       OR NEW.evidence_snapshot_ids IS DISTINCT FROM OLD.evidence_snapshot_ids
       OR NEW.before_value IS DISTINCT FROM OLD.before_value
       OR NEW.after_value IS DISTINCT FROM OLD.after_value
       OR NEW.entity_type IS DISTINCT FROM OLD.entity_type
       OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
       OR NEW.field_name IS DISTINCT FROM OLD.field_name
       OR NEW.change_type IS DISTINCT FROM OLD.change_type
       OR NEW.published_at IS DISTINCT FROM OLD.published_at
       OR NEW.supersedes_receipt_id IS DISTINCT FROM OLD.supersedes_receipt_id THEN
      RAISE EXCEPTION 'publication receipt history cannot be rewritten';
    END IF;
    IF NOT publication_verification_state_allowed(OLD.verification_state, NEW.verification_state) THEN
      RAISE EXCEPTION 'publication verification state cannot be rewritten';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS publication_receipts_protect_history ON publication_receipts;
CREATE TRIGGER publication_receipts_protect_history
  BEFORE UPDATE ON publication_receipts
  FOR EACH ROW
  EXECUTE PROCEDURE protect_publication_receipt_history();
