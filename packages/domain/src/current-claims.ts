import type { AssessmentState, KnowledgeState } from "./knowledge-state.ts";
import { canonicalJson } from "./scoring/hash.ts";

export const ASSESSMENT_AUTHORITY_RANK: Record<AssessmentState, number> = {
  rejected: 0,
  "legacy/unverified": 1,
  inferred: 2,
  extracted: 3,
  provider_asserted: 4,
  editorially_reviewed: 5,
  independently_verified: 6,
};

export type ClaimRecord = {
  id: string;
  subjectType: string;
  subjectId: string;
  claimType: string;
  value: unknown;
  knowledgeState: KnowledgeState;
  assessmentState: AssessmentState;
  observedAt: string | null;
  recordedAt: string;
  validFrom: string | null;
  validTo: string | null;
  supersededBy: string | null;
  sourceId?: string | null;
  evidenceIds?: string[];
};

export type CurrentClaim = ClaimRecord & {
  contributingIds: string[];
};

/**
 * Public current state is the latest verified publication, not the mutable CAS
 * row (which may already contain an unverified write). Publication order wins
 * over observation time. Keep tombstones in authoritative until AFTER excluding
 * legacy keys so a retraction can never resurrect a stale table-backed claim.
 * Keys without verified state retain the deterministic legacy resolver.
 */
export const CURRENT_CLAIMS_AT_SQL = `
WITH authoritative AS (
  SELECT DISTINCT ON (r.entity_type, r.entity_id, r.field_name)
    r.*, e.observed_at, e.value_sensitivity
  FROM publication_receipts r
  JOIN change_events e ON e.receipt_id = r.id
  WHERE r.verification_state = 'verified'
    AND r.published_at <= $1::timestamptz
    AND r.verified_at <= $1::timestamptz
    AND ($2::text IS NULL OR r.entity_type = $2)
    AND ($3::text IS NULL OR r.entity_id = $3)
  ORDER BY r.entity_type, r.entity_id, r.field_name, r.published_at DESC, r.id DESC, e.id DESC
), current_state AS (
  SELECT
    entity_type || ':' || entity_id || ':' || field_name AS id,
    entity_type AS subject_type, entity_id AS subject_id, field_name AS claim_type,
    CASE WHEN value_sensitivity = 'redacted' THEN NULL::jsonb ELSE after_value END AS value,
    knowledge_state, assessment_state, observed_at, published_at AS recorded_at,
    NULL::timestamptz AS valid_from, NULL::timestamptz AS valid_to,
    NULL::text AS superseded_by, ARRAY[id]::text[] AS contributing_ids,
    verification_state, change_type, value_sensitivity
  FROM authoritative
  WHERE change_type <> 'retract' AND knowledge_state <> 'confirmed_absent'
  UNION ALL
  SELECT
    c.id, c.subject_type, c.subject_id, c.claim_type, c.value,
    c.knowledge_state, c.assessment_state, c.observed_at, c.recorded_at,
    c.valid_from, c.valid_to, c.superseded_by, c.contributing_ids,
    NULL::text AS verification_state, NULL::text AS change_type, 'public'::text AS value_sensitivity
  FROM current_claims_at($1) c
  WHERE ($2::text IS NULL OR c.subject_type = $2)
    AND ($3::text IS NULL OR c.subject_id = $3)
    AND NOT EXISTS (
      SELECT 1 FROM authoritative a
      WHERE a.entity_type = c.subject_type AND a.entity_id = c.subject_id AND a.field_name = c.claim_type
    )
)
SELECT * FROM current_state
ORDER BY subject_type, subject_id, claim_type, id
`;

function rankOf(state: AssessmentState): number {
  return ASSESSMENT_AUTHORITY_RANK[state] ?? -1;
}

export function claimIsTemporallyValid(claim: ClaimRecord, now: string): boolean {
  if (claim.assessmentState === "rejected") return false;
  if (claim.validFrom != null && claim.validFrom > now) return false;
  if (claim.validTo != null && claim.validTo < now) return false;
  return true;
}

function valueKey(value: unknown): string {
  return canonicalJson(value) ?? "null";
}

function compareLatest(a: ClaimRecord, b: ClaimRecord): number {
  const aObs = a.observedAt;
  const bObs = b.observedAt;
  if (aObs == null && bObs == null) return b.id.localeCompare(a.id);
  if (aObs == null) return 1;
  if (bObs == null) return -1;
  const byObs = bObs.localeCompare(aObs);
  if (byObs !== 0) return byObs;
  return b.id.localeCompare(a.id);
}

function blockedBySupersession(claims: readonly ClaimRecord[]): Set<string> {
  const byId = new Map(claims.map((row) => [row.id, row]));
  const blocked = new Set<string>();
  for (const origin of claims) {
    const seen: string[] = [];
    let node: ClaimRecord | undefined = origin;
    let steps = 0;
    while (node?.supersededBy && steps < 64) {
      if (seen.includes(node.id)) {
        blocked.add(origin.id);
        for (const id of seen) blocked.add(id);
        break;
      }
      seen.push(node.id);
      const next = byId.get(node.supersededBy);
      if (!next) {
        blocked.add(origin.id);
        break;
      }
      blocked.add(node.id);
      node = next;
      steps += 1;
    }
  }
  return blocked;
}

function groupKey(claim: ClaimRecord): string {
  return `${claim.subjectType}\0${claim.subjectId}\0${claim.claimType}`;
}

function mergeEvidence(rows: readonly ClaimRecord[]): string[] | undefined {
  const ids = rows.flatMap((row) => row.evidenceIds ?? []);
  if (ids.length === 0) return undefined;
  return [...new Set(ids)].sort();
}

export function resolveCurrentClaims(claims: readonly ClaimRecord[], now: string): CurrentClaim[] {
  const blocked = blockedBySupersession(claims);
  const valid = claims.filter((row) => !blocked.has(row.id) && claimIsTemporallyValid(row, now) && rankOf(row.assessmentState) > 0);
  const groups = new Map<string, ClaimRecord[]>();
  for (const row of valid) {
    const key = groupKey(row);
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  const result: CurrentClaim[] = [];
  for (const members of groups.values()) {
    const maxRank = Math.max(...members.map((row) => rankOf(row.assessmentState)));
    const authoritative = members.filter((row) => rankOf(row.assessmentState) === maxRank);
    authoritative.sort(compareLatest);
    const latest = authoritative[0];
    if (!latest) continue;
    const keys = new Set(authoritative.map((row) => valueKey(row.value)));
    const contributingIds = [...new Set(authoritative.map((row) => row.id))].sort();
    if (keys.size > 1) {
      result.push({
        ...latest,
        value: null,
        knowledgeState: "conflicting",
        contributingIds,
        evidenceIds: mergeEvidence(authoritative),
      });
      continue;
    }
    result.push({
      ...latest,
      contributingIds: [latest.id],
      evidenceIds: latest.evidenceIds,
    });
  }
  result.sort((a, b) => groupKey(a).localeCompare(groupKey(b)) || a.id.localeCompare(b.id));
  return result;
}
