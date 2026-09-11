-- 0007_collection_pipeline.sql
-- Durable collection tasks and model runs. Fetch receipts stay immutable.
-- Workers may persist receipts and proposals only. Public catalog tables are unchanged.

ALTER TABLE fetch_snapshots
  ADD COLUMN IF NOT EXISTS fetch_state TEXT
    CHECK (fetch_state IS NULL OR fetch_state IN (
      'ok', 'redirect', 'forbidden', 'not_found', 'timeout', 'blocked',
      'oversized', 'malformed', 'unsupported_content_type'
    ));

ALTER TABLE fetch_snapshots
  ADD COLUMN IF NOT EXISTS redirect_chain JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE fetch_snapshots
  ADD COLUMN IF NOT EXISTS truncated BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS collection_tasks (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  source_url TEXT NOT NULL,
  provider_id TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'queued', 'leased', 'fetched', 'extracted', 'verified', 'proposed', 'failed'
  )),
  fetch_state TEXT CHECK (fetch_state IS NULL OR fetch_state IN (
    'ok', 'redirect', 'forbidden', 'not_found', 'timeout', 'blocked',
    'oversized', 'malformed', 'unsupported_content_type'
  )),
  lease_owner TEXT CHECK (lease_owner IS NULL OR lease_owner ~ '^[a-z][a-z0-9_-]{0,63}$'),
  lease_until TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  snapshot_id TEXT REFERENCES fetch_snapshots(id) ON DELETE RESTRICT,
  last_error TEXT,
  fetched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_collection_tasks_status ON collection_tasks (status);
CREATE INDEX IF NOT EXISTS idx_collection_tasks_lease ON collection_tasks (lease_owner, lease_until);

CREATE TABLE IF NOT EXISTS model_runs (
  id TEXT PRIMARY KEY,
  collection_task_id TEXT NOT NULL REFERENCES collection_tasks(id) ON DELETE CASCADE,
  adapter_name TEXT NOT NULL,
  model_provider TEXT NOT NULL,
  model_name TEXT NOT NULL,
  ruleset_version TEXT NOT NULL,
  input_digest TEXT NOT NULL CHECK (input_digest ~ '^[0-9a-f]{64}$'),
  output_digest TEXT NOT NULL CHECK (output_digest ~ '^[0-9a-f]{64}$'),
  envelope JSONB NOT NULL,
  output JSONB NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (collection_task_id, adapter_name, input_digest)
);

CREATE INDEX IF NOT EXISTS idx_model_runs_task ON model_runs (collection_task_id);

CREATE OR REPLACE FUNCTION forbid_model_run_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'model_runs are immutable';
END;
$$;

DROP TRIGGER IF EXISTS model_runs_immutable_upd ON model_runs;
CREATE TRIGGER model_runs_immutable_upd
  BEFORE UPDATE ON model_runs
  FOR EACH ROW
  EXECUTE PROCEDURE forbid_model_run_mutation();

DROP TRIGGER IF EXISTS model_runs_immutable_del ON model_runs;
CREATE TRIGGER model_runs_immutable_del
  BEFORE DELETE ON model_runs
  FOR EACH ROW
  EXECUTE PROCEDURE forbid_model_run_mutation();

CREATE OR REPLACE FUNCTION preserve_collection_fetched_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.fetched_at IS NOT NULL AND NEW.fetched_at IS DISTINCT FROM OLD.fetched_at THEN
    RAISE EXCEPTION 'collection_tasks.fetched_at is immutable once set';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS collection_tasks_fetched_at_immutable ON collection_tasks;
CREATE TRIGGER collection_tasks_fetched_at_immutable
  BEFORE UPDATE ON collection_tasks
  FOR EACH ROW
  EXECUTE PROCEDURE preserve_collection_fetched_at();
