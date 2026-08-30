CREATE TABLE IF NOT EXISTS correction_requests (
  id serial PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('rescan','claim')),
  provider_id text NOT NULL REFERENCES providers(id),
  requester_email text,
  token text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','notified','approved','verified','expired','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz
);
CREATE INDEX IF NOT EXISTS correction_requests_provider_created
  ON correction_requests (kind, provider_id, created_at DESC);

CREATE TABLE IF NOT EXISTS provider_claims (
  provider_id text PRIMARY KEY REFERENCES providers(id),
  email text NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now()
);
