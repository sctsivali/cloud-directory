-- 0006_proposals_reviews_revisions.sql
-- Durable proposal workflow. Digest-bound idempotency. No publication receipts.

CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  tool_name TEXT NOT NULL,
  actor_id TEXT NOT NULL CHECK (actor_id ~ '^[a-z][a-z0-9_-]{0,63}$'),
  idempotency_key TEXT NOT NULL,
  body JSONB NOT NULL,
  body_digest TEXT NOT NULL CHECK (body_digest ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL CHECK (status IN (
    'pending_review', 'approved', 'rejected', 'changes_requested'
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals (status);
CREATE INDEX IF NOT EXISTS idx_proposals_actor ON proposals (actor_id);

CREATE TABLE IF NOT EXISTS revisions (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  revision_ordinal INTEGER NOT NULL CHECK (revision_ordinal >= 1),
  body JSONB NOT NULL,
  body_digest TEXT NOT NULL CHECK (body_digest ~ '^[0-9a-f]{64}$'),
  actor_id TEXT NOT NULL CHECK (actor_id ~ '^[a-z][a-z0-9_-]{0,63}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (proposal_id, revision_ordinal)
);

CREATE TABLE IF NOT EXISTS proposal_reviews (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  reviewer_id TEXT NOT NULL CHECK (reviewer_id ~ '^[a-z][a-z0-9_-]{0,63}$'),
  decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject', 'request_changes')),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  invalidated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_proposal_reviews_proposal ON proposal_reviews (proposal_id);

CREATE OR REPLACE FUNCTION forbid_proposal_self_approval()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  proposer text;
BEGIN
  IF NEW.decision = 'approve' THEN
    SELECT actor_id INTO proposer FROM proposals WHERE id = NEW.proposal_id;
    IF proposer IS NOT NULL AND proposer = NEW.reviewer_id THEN
      RAISE EXCEPTION 'proposal cannot self-approve';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS proposal_reviews_no_self_approval ON proposal_reviews;
CREATE TRIGGER proposal_reviews_no_self_approval
  BEFORE INSERT OR UPDATE ON proposal_reviews
  FOR EACH ROW
  EXECUTE PROCEDURE forbid_proposal_self_approval();
