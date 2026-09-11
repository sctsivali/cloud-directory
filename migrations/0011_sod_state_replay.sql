-- 0011_sod_state_replay.sql
-- Separation of duties for revision authors, proposal status transitions,
-- and approval binding to the exact locked revision digest.

CREATE OR REPLACE FUNCTION forbid_proposal_self_approval()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  proposer text;
  reviser text;
BEGIN
  IF NEW.decision = 'approve' THEN
    PERFORM 1 FROM proposals WHERE id = NEW.proposal_id FOR UPDATE;
    SELECT actor_id INTO proposer FROM proposals WHERE id = NEW.proposal_id;
    SELECT actor_id INTO reviser
      FROM revisions
      WHERE id = (
        SELECT id FROM revisions
        WHERE proposal_id = NEW.proposal_id
        ORDER BY revision_ordinal DESC
        LIMIT 1
      )
      FOR UPDATE;
    IF proposer IS NOT NULL AND proposer = NEW.reviewer_id THEN
      RAISE EXCEPTION 'proposal cannot self-approve';
    END IF;
    IF reviser IS NOT NULL AND reviser = NEW.reviewer_id THEN
      RAISE EXCEPTION 'revision author cannot self-approve';
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

ALTER TABLE proposal_reviews DROP CONSTRAINT IF EXISTS proposal_reviews_approve_binding;
ALTER TABLE proposal_reviews ADD CONSTRAINT proposal_reviews_approve_binding
  CHECK (
    decision <> 'approve'
    OR (
      bound_revision_id IS NOT NULL
      AND bound_body_digest IS NOT NULL
      AND bound_body_digest ~ '^[0-9a-f]{64}$'
    )
  );

CREATE OR REPLACE FUNCTION forbid_proposal_self_publish()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  proposer text;
  reviser text;
BEGIN
  SELECT actor_id INTO proposer FROM proposals WHERE id = NEW.proposal_id;
  SELECT actor_id INTO reviser FROM revisions WHERE id = NEW.revision_id;
  IF proposer IS NOT NULL AND proposer = NEW.publisher_id THEN
    RAISE EXCEPTION 'proposal author cannot publish own proposal';
  END IF;
  IF reviser IS NOT NULL AND reviser = NEW.publisher_id THEN
    RAISE EXCEPTION 'revision author cannot publish own revision';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS publication_receipts_no_self_publish ON publication_receipts;
CREATE TRIGGER publication_receipts_no_self_publish
  BEFORE INSERT OR UPDATE ON publication_receipts
  FOR EACH ROW
  EXECUTE PROCEDURE forbid_proposal_self_publish();

CREATE OR REPLACE FUNCTION forbid_publication_self_verify()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  proposer text;
  reviser text;
BEGIN
  IF NEW.verified_by IS NOT NULL THEN
    IF NEW.verified_by = NEW.publisher_id THEN
      RAISE EXCEPTION 'publisher cannot verify their own publication';
    END IF;
    SELECT actor_id INTO proposer FROM proposals WHERE id = NEW.proposal_id;
    SELECT actor_id INTO reviser FROM revisions WHERE id = NEW.revision_id;
    IF proposer IS NOT NULL AND proposer = NEW.verified_by THEN
      RAISE EXCEPTION 'proposal author cannot verify their own publication';
    END IF;
    IF reviser IS NOT NULL AND reviser = NEW.verified_by THEN
      RAISE EXCEPTION 'revision author cannot verify their own publication';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS publication_receipts_no_self_verify ON publication_receipts;
CREATE TRIGGER publication_receipts_no_self_verify
  BEFORE INSERT OR UPDATE ON publication_receipts
  FOR EACH ROW
  EXECUTE PROCEDURE forbid_publication_self_verify();

CREATE OR REPLACE FUNCTION proposal_status_transition_allowed(old_status text, new_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN old_status IS NOT DISTINCT FROM new_status THEN true
    WHEN old_status = 'pending_review' THEN new_status IN ('pending_review', 'approved', 'rejected', 'changes_requested')
    WHEN old_status = 'changes_requested' THEN new_status IN ('pending_review', 'approved', 'rejected', 'changes_requested')
    WHEN old_status = 'approved' THEN new_status IN ('pending_review', 'published')
    WHEN old_status = 'rejected' THEN new_status = 'pending_review'
    WHEN old_status = 'published' THEN new_status = 'pending_review'
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION protect_proposal_status_transitions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NOT proposal_status_transition_allowed(OLD.status, NEW.status) THEN
      RAISE EXCEPTION 'illegal proposal status transition: % -> %', OLD.status, NEW.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS proposals_protect_status ON proposals;
CREATE TRIGGER proposals_protect_status
  BEFORE UPDATE ON proposals
  FOR EACH ROW
  EXECUTE PROCEDURE protect_proposal_status_transitions();
