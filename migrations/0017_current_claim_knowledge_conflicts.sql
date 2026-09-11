-- Additive correction to manifest-bound 0015: conflict identity is the semantic
-- pair (knowledge_state, canonical JSON value), not the value alone.
-- All authority, temporal, supersession and deterministic ordering rules remain.

CREATE OR REPLACE FUNCTION current_claims_at(at timestamptz DEFAULT now())
RETURNS TABLE (
  id text,
  subject_type text,
  subject_id text,
  claim_type text,
  value jsonb,
  knowledge_state text,
  assessment_state text,
  observed_at timestamptz,
  recorded_at timestamptz,
  valid_from timestamptz,
  valid_to timestamptz,
  superseded_by text,
  contributing_ids text[]
)
LANGUAGE sql
STABLE
AS $$
  WITH RECURSIVE walk AS (
    SELECT
      c.id AS origin,
      c.id AS node,
      c.superseded_by AS nxt,
      ARRAY[c.id] AS path,
      false AS cyclic,
      (c.superseded_by IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM claims t WHERE t.id = c.superseded_by
      )) AS missing
    FROM claims c
    UNION ALL
    SELECT
      w.origin,
      t.id,
      t.superseded_by,
      w.path || t.id,
      t.id = ANY (w.path),
      false
    FROM walk w
    JOIN claims t ON t.id = w.nxt
    WHERE w.nxt IS NOT NULL
      AND NOT w.cyclic
      AND NOT w.missing
      AND cardinality(w.path) < 64
  ),
  blocked AS (
    SELECT DISTINCT origin AS id
    FROM walk
    WHERE cyclic OR missing
    UNION
    SELECT c.id
    FROM claims c
    WHERE c.superseded_by IS NOT NULL
      AND EXISTS (SELECT 1 FROM claims t WHERE t.id = c.superseded_by)
  ),
  valid AS (
    SELECT c.*
    FROM claims c
    WHERE c.assessment_state IS DISTINCT FROM 'rejected'
      AND (c.valid_from IS NULL OR c.valid_from <= at)
      AND (c.valid_to IS NULL OR c.valid_to >= at)
      AND NOT EXISTS (SELECT 1 FROM blocked b WHERE b.id = c.id)
  ),
  ranked AS (
    SELECT
      v.*,
      claim_assessment_rank(v.assessment_state) AS rank,
      max(claim_assessment_rank(v.assessment_state)) OVER (
        PARTITION BY v.subject_type, v.subject_id, v.claim_type
      ) AS max_rank
    FROM valid v
  ),
  authoritative AS (
    SELECT r.*
    FROM ranked r
    WHERE r.rank = r.max_rank AND r.rank > 0
  ),
  grouped AS (
    SELECT
      a.subject_type,
      a.subject_id,
      a.claim_type,
      count(DISTINCT jsonb_build_array(a.knowledge_state, a.value)) AS value_n,
      array_agg(a.id ORDER BY a.observed_at DESC NULLS LAST, a.id DESC) AS ids
    FROM authoritative a
    GROUP BY a.subject_type, a.subject_id, a.claim_type
  )
  SELECT
    c.id,
    c.subject_type,
    c.subject_id,
    c.claim_type,
    CASE WHEN g.value_n > 1 THEN NULL ELSE c.value END,
    CASE WHEN g.value_n > 1 THEN 'conflicting' ELSE c.knowledge_state END,
    c.assessment_state,
    c.observed_at,
    c.recorded_at,
    c.valid_from,
    c.valid_to,
    c.superseded_by,
    g.ids
  FROM grouped g
  JOIN claims c ON c.id = g.ids[1]
$$;

COMMENT ON FUNCTION current_claims_at(timestamptz) IS
  'L7 current claims at a clock: valid unsuperseded latest observations, preserving assessment authority; conflicting when current authoritative knowledge states or values disagree.';
