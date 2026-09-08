-- Schema changes in this file are deprecated.
-- Canonical schema is migrations/0001_legacy_baseline.sql (scripts/migrate.py).
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS facilities text;
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS last_checked_at timestamptz;
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS check_source text;
