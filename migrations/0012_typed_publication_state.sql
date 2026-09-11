-- Typed authority for the publication ledger; never infer verification from legacy JSON.
-- Additional trigger supplements (never replaces) the existing receipt security guards.
CREATE FUNCTION guard_receipt_typed_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.knowledge_state IS DISTINCT FROM OLD.knowledge_state
     OR NEW.assessment_state IS DISTINCT FROM OLD.assessment_state THEN
    RAISE EXCEPTION 'publication receipt typed state is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER publication_receipts_typed_state_immutable
  BEFORE UPDATE ON publication_receipts FOR EACH ROW
  EXECUTE FUNCTION guard_receipt_typed_state();
ALTER TABLE canonical_states
  ADD COLUMN knowledge_state TEXT NOT NULL DEFAULT 'unknown' CHECK (knowledge_state IN ('present','confirmed_absent','unknown','not_applicable','conflicting')),
  ADD COLUMN assessment_state TEXT NOT NULL DEFAULT 'legacy/unverified' CHECK (assessment_state IN ('extracted','inferred','provider_asserted','editorially_reviewed','independently_verified','rejected','legacy/unverified'));
ALTER TABLE publication_receipts
  ADD COLUMN knowledge_state TEXT NOT NULL DEFAULT 'unknown' CHECK (knowledge_state IN ('present','confirmed_absent','unknown','not_applicable','conflicting')),
  ADD COLUMN assessment_state TEXT NOT NULL DEFAULT 'legacy/unverified' CHECK (assessment_state IN ('extracted','inferred','provider_asserted','editorially_reviewed','independently_verified','rejected','legacy/unverified'));
ALTER TABLE change_events
  ADD COLUMN knowledge_state TEXT NOT NULL DEFAULT 'unknown' CHECK (knowledge_state IN ('present','confirmed_absent','unknown','not_applicable','conflicting')),
  ADD COLUMN assessment_state TEXT NOT NULL DEFAULT 'legacy/unverified' CHECK (assessment_state IN ('extracted','inferred','provider_asserted','editorially_reviewed','independently_verified','rejected','legacy/unverified'));
