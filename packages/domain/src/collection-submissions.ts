export const SUBMISSION_OUTCOMES = ["created", "replayed", "rejected", "ambiguous"] as const;
export type SubmissionOutcomeKind = (typeof SUBMISSION_OUTCOMES)[number];

export const COLLECTION_TASK_STATUSES = [
  "queued",
  "leased",
  "fetched",
  "extracted",
  "verified",
  "proposed",
  "failed",
  "needs_review",
  "ambiguous",
] as const;
export type CollectionTaskStatus = (typeof COLLECTION_TASK_STATUSES)[number];

export const MAX_SUBMISSION_REASON_CODES = 16;
export const MAX_REQUIRED_SUBMISSIONS = 64;
export const SUBMISSION_REASON_CODE_RE = /^[a-z][a-z0-9_]{0,63}$/;

export const SUBMISSION_REASON_CODES = [
  "excerpt_missing",
  "subject_mismatch",
  "negated_kvm",
  "hedged_statement",
  "excerpt_mismatch",
  "office_not_facility",
  "non_official_source",
  "stale_evidence",
  "ai_disagreement",
  "independently_verified_unjustified",
  "malformed_payload",
  "idempotency_conflict",
  "tool_unavailable",
  "commit_uncertain",
  "digest_conflict",
  "mcp_rejected",
] as const;
export type SubmissionReasonCode = (typeof SUBMISSION_REASON_CODES)[number];

const VERIFIER_REASON_MAP: Record<string, SubmissionReasonCode> = {
  "exact excerpt missing from snapshot": "excerpt_missing",
  "assertion subject does not match evidence subject": "subject_mismatch",
  "negated KVM cannot be present": "negated_kvm",
  "hedged statement cannot be independently verified": "hedged_statement",
  "excerpt does not mention the claimed technology": "excerpt_mismatch",
  "office address is not a data-centre facility": "office_not_facility",
  "non-official source cannot independently verify": "non_official_source",
  "stale evidence cannot be presented as current": "stale_evidence",
  "ai disagreement is conflicting/needs_review, not majority truth": "ai_disagreement",
  "independently_verified is not justified": "independently_verified_unjustified",
};

const MCP_CODE_MAP: Record<string, SubmissionReasonCode> = {
  malformed_payload: "malformed_payload",
  idempotency_conflict: "idempotency_conflict",
  tool_unavailable: "tool_unavailable",
  commit_uncertain: "commit_uncertain",
  digest_conflict: "digest_conflict",
};

export type CollectionSubmissionOutcome = {
  taskId: string;
  toolName: string;
  idempotencyKey: string;
  requestDigest: string;
  outcome: SubmissionOutcomeKind;
  proposalId: string | null;
  reasonCodes: readonly SubmissionReasonCode[];
  createdAt: string;
};

export function isSubmissionOutcome(value: string): value is SubmissionOutcomeKind {
  return (SUBMISSION_OUTCOMES as readonly string[]).includes(value);
}

export function isAllowedReasonCode(code: string): code is SubmissionReasonCode {
  return (
    (SUBMISSION_REASON_CODES as readonly string[]).includes(code) && SUBMISSION_REASON_CODE_RE.test(code)
  );
}

export function boundReasonCodes(input: readonly string[]): SubmissionReasonCode[] {
  if (input.length > MAX_SUBMISSION_REASON_CODES) {
    throw new Error("reason code out of bounds");
  }
  const out: SubmissionReasonCode[] = [];
  for (const code of input) {
    if (!isAllowedReasonCode(code)) {
      throw new Error("reason code out of bounds");
    }
    if (!out.includes(code)) out.push(code);
  }
  return out;
}

export function reasonCodesFromVerifierReasons(reasons: readonly string[]): SubmissionReasonCode[] {
  const mapped = reasons.map((reason) => VERIFIER_REASON_MAP[reason] ?? "mcp_rejected");
  return boundReasonCodes(mapped.slice(0, MAX_SUBMISSION_REASON_CODES));
}

export function reasonCodesFromMcpCode(code: string | null | undefined): SubmissionReasonCode[] {
  if (!code) return [];
  const mapped = MCP_CODE_MAP[code] ?? "mcp_rejected";
  return boundReasonCodes([mapped]);
}

export function isAmbiguousTerminal(outcome: SubmissionOutcomeKind): boolean {
  return outcome === "ambiguous";
}

export function shouldAutoRetrySubmission(
  existing: { outcome: SubmissionOutcomeKind } | null | undefined
): boolean {
  return existing == null;
}

export type SubmissionIdentity = {
  taskId: string;
  toolName: string;
  idempotencyKey: string;
  requestDigest: string;
};

export function submissionIdentityMatches(
  existing: SubmissionIdentity,
  incoming: SubmissionIdentity
): boolean {
  return (
    existing.taskId === incoming.taskId &&
    existing.toolName === incoming.toolName &&
    existing.idempotencyKey === incoming.idempotencyKey &&
    existing.requestDigest === incoming.requestDigest
  );
}

export function requireSubmissionIdentity(
  existing: SubmissionIdentity | null | undefined,
  incoming: SubmissionIdentity
): SubmissionIdentity | null {
  if (existing == null) return null;
  if (!submissionIdentityMatches(existing, incoming)) {
    throw new Error("idempotency identity collision");
  }
  return existing;
}

export type RequiredSubmission = {
  idempotencyKey: string;
  outcome: SubmissionOutcomeKind;
};

export function boundRequiredSubmissionCount(count: number): number {
  if (!Number.isInteger(count) || count < 0 || count > MAX_REQUIRED_SUBMISSIONS) {
    throw new Error("required_submission_count out of bounds");
  }
  return count;
}

export function resolveCollectionTaskStatus(
  required: readonly RequiredSubmission[],
  requiredCount: number
): "proposed" | "failed" | "ambiguous" | "needs_review" {
  if (!Number.isInteger(requiredCount) || requiredCount < 1 || requiredCount > MAX_REQUIRED_SUBMISSIONS) {
    return "failed";
  }
  const keys = new Set(required.map((row) => row.idempotencyKey));
  if (required.some((row) => row.outcome === "ambiguous")) return "ambiguous";
  if (required.some((row) => row.outcome === "rejected")) return "failed";
  if (
    keys.size === requiredCount &&
    required.length === requiredCount &&
    required.every((row) => row.outcome === "created" || row.outcome === "replayed")
  ) {
    return "proposed";
  }
  return "failed";
}
