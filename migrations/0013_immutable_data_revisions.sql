-- B1: reproducible intelligence snapshots. Unknown legacy verification times are
-- intentionally not backdated to publication time; those receipts remain excluded.
CREATE TABLE data_revisions (
  id TEXT PRIMARY KEY,
  cutoff_at TIMESTAMPTZ NOT NULL,
  receipt_ids TEXT[] NOT NULL,
  receipt_set_sha256 TEXT NOT NULL UNIQUE CHECK (receipt_set_sha256 ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (cutoff_at <= created_at)
);

CREATE FUNCTION protect_data_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  expected TEXT[];
  digest TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'data revision is immutable';
  END IF;
  SELECT coalesce(array_agg(id ORDER BY id COLLATE "C"), ARRAY[]::text[]) INTO expected
    FROM publication_receipts
    WHERE verification_state = 'verified' AND published_at <= NEW.cutoff_at
      AND verified_at IS NOT NULL AND verified_at >= published_at AND verified_at <= NEW.cutoff_at;
  digest := encode(sha256(convert_to(array_to_json(expected)::text, 'UTF8')), 'hex');
  IF NEW.receipt_ids IS DISTINCT FROM expected OR NEW.receipt_set_sha256 <> digest
     OR NEW.id <> 'drv-' || digest THEN
    RAISE EXCEPTION 'invalid data revision receipt set or digest';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER data_revisions_immutable BEFORE INSERT OR UPDATE OR DELETE ON data_revisions
  FOR EACH ROW EXECUTE FUNCTION protect_data_revision();
CREATE TRIGGER data_revisions_no_truncate BEFORE TRUNCATE ON data_revisions
  FOR EACH STATEMENT EXECUTE FUNCTION protect_data_revision();

CREATE FUNCTION capture_data_revision(cutoff TIMESTAMPTZ DEFAULT statement_timestamp())
RETURNS SETOF data_revisions LANGUAGE plpgsql AS $$
DECLARE
  ids TEXT[];
  digest TEXT;
BEGIN
  IF cutoff IS NULL OR cutoff > clock_timestamp() THEN
    RAISE EXCEPTION 'invalid data revision cutoff';
  END IF;
  -- Serialize capture (including same-digest races) without mutating an old row.
  PERFORM pg_advisory_xact_lock(726332);
  SELECT coalesce(array_agg(id ORDER BY id COLLATE "C"), ARRAY[]::text[]) INTO ids
    FROM publication_receipts
    WHERE verification_state = 'verified' AND published_at <= cutoff
      AND verified_at IS NOT NULL AND verified_at >= published_at AND verified_at <= cutoff;
  digest := encode(sha256(convert_to(array_to_json(ids)::text, 'UTF8')), 'hex');
  INSERT INTO data_revisions (id, cutoff_at, receipt_ids, receipt_set_sha256)
    VALUES ('drv-' || digest, cutoff, ids, digest) ON CONFLICT (receipt_set_sha256) DO NOTHING;
  RETURN QUERY SELECT * FROM data_revisions WHERE receipt_set_sha256 = digest;
END;
$$;

CREATE FUNCTION protect_receipt_verification_time() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM data_revisions WHERE OLD.id = ANY(receipt_ids)) THEN
      RAISE EXCEPTION 'snapshot receipt cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.verification_state IN ('verified', 'rolled_back') AND OLD.verified_at IS NOT NULL AND
     NEW.verified_at IS DISTINCT FROM OLD.verified_at THEN
    RAISE EXCEPTION 'publication verification time is immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.verification_state = 'verified' AND OLD.verification_state <> 'verified' THEN
    NEW.verified_at := clock_timestamp();
  ELSIF NEW.verification_state = 'verified' AND NEW.verified_at IS NULL THEN
    NEW.verified_at := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER publication_receipts_verification_time BEFORE INSERT OR UPDATE OR DELETE ON publication_receipts
  FOR EACH ROW EXECUTE FUNCTION protect_receipt_verification_time();

CREATE FUNCTION protect_snapshot_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND EXISTS (SELECT 1 FROM data_revisions WHERE OLD.receipt_id = ANY(receipt_ids)) THEN
    RAISE EXCEPTION 'snapshot event is immutable';
  END IF;
  IF TG_OP <> 'DELETE' AND EXISTS (SELECT 1 FROM data_revisions WHERE NEW.receipt_id = ANY(receipt_ids)) THEN
    RAISE EXCEPTION 'snapshot event is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER change_events_snapshot_history BEFORE INSERT OR UPDATE OR DELETE ON change_events
  FOR EACH ROW EXECUTE FUNCTION protect_snapshot_event();

CREATE INDEX idx_publication_receipts_available ON publication_receipts (verified_at, published_at)
  WHERE verification_state = 'verified';

CREATE FUNCTION protect_snapshot_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM data_revisions) THEN
    RAISE EXCEPTION 'snapshot history cannot be truncated';
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER publication_receipts_no_snapshot_truncate BEFORE TRUNCATE ON publication_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION protect_snapshot_truncate();
CREATE TRIGGER change_events_no_snapshot_truncate BEFORE TRUNCATE ON change_events
  FOR EACH STATEMENT EXECUTE FUNCTION protect_snapshot_truncate();
