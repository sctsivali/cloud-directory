CREATE TABLE IF NOT EXISTS provider_pipeline (
  id serial PRIMARY KEY,
  name text NOT NULL,
  website text,
  country text,
  status text NOT NULL DEFAULT 'discovered'
    CHECK (status IN ('discovered','queued','crawling','needs_review','ingested','rejected')),
  reason text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS provider_pipeline_website_uidx
  ON provider_pipeline (lower(website))
  WHERE website IS NOT NULL AND website <> '';
CREATE INDEX IF NOT EXISTS provider_pipeline_status_idx ON provider_pipeline (status, updated_at DESC);
