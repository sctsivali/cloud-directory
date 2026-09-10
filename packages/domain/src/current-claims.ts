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

export const CURRENT_CLAIMS_AT_SQL = `
SELECT
  id,
  subject_type,
  subject_id,
  claim_type,
  value,
  knowledge_state,
  assessment_state,
  observed_at,
  recorded_at,
  valid_from,
  valid_to,
  superseded_by,
  contributing_ids
FROM current_claims_at($1)
WHERE ($2::text IS NULL OR subject_type = $2)
  AND ($3::text IS NULL OR subject_id = $3)
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
