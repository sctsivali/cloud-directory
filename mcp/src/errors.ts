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
} as const;

export class CommitUncertainError extends Error {
  constructor(message = "proposal commit could not be confirmed") {
    super(message);
    this.name = "CommitUncertainError";
  }
}
