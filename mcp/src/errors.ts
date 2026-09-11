export const OUTCOME = {
  created: "created",
  replayed: "replayed",
  rejected: "rejected",
  ambiguous: "ambiguous",
} as const;

export const ERROR_CODE = {
  malformedPayload: "malformed_payload",
  idempotencyConflict: "idempotency_conflict",
  selfApprovalForbidden: "self_approval_forbidden",
  toolUnavailable: "tool_unavailable",
  capabilityMissing: "capability_missing",
  commitUncertain: "commit_uncertain",
  notFound: "not_found",
  invalidPrincipal: "invalid_principal",
  selfPublishForbidden: "self_publish_forbidden",
  staleApproval: "stale_approval",
  casConflict: "canonical_state_conflict",
  selfVerifyForbidden: "self_verify_forbidden",
  verificationMismatch: "verification_mismatch",
  illegalStateTransition: "illegal_state_transition",
} as const;

export class CommitUncertainError extends Error {
  constructor(message = "proposal commit could not be confirmed") {
    super(message);
    this.name = "CommitUncertainError";
  }
}
