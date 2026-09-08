import { validateToolInput } from "../../packages/contracts/src/mcp.ts";
import { canAssignMapPrecision, validateFacility } from "../../packages/domain/src/geography.ts";
import { validateOffering } from "../../packages/domain/src/entity-validation.ts";
import { validateTechnologyDeployment } from "../../packages/domain/src/technology.ts";
import { validateClaim } from "../../packages/domain/src/claim-validation.ts";
import type { AssessmentState, KnowledgeState } from "../../packages/domain/src/knowledge-state.ts";
import { bodyDigest, proposalBodyForDigest } from "./digest.ts";
import { ERROR_CODE, OUTCOME } from "./errors.ts";
import {
  bindPrincipal,
  rejectModelIdentity,
} from "./principal.ts";
import {
  newProposalId,
  nowIso,
  type ProposalRepository,
} from "./store.ts";
import type { ProposalRecord, ProposalSubmitResult, RejectedOutcome } from "./types.ts";

function rejected(code: string, message: string, errors?: string[]): RejectedOutcome {
  return { outcome: OUTCOME.rejected, code, message, errors };
}

function asRecord(input: unknown): Record<string, unknown> | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  return input as Record<string, unknown>;
}

function extraDomainErrors(toolName: string, input: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (toolName === "directory.propose_claim") {
    const result = validateClaim({
      subjectType: input.subjectType as never,
      subjectId: String(input.subjectId ?? ""),
      claimType: String(input.claimType ?? ""),
      value: input.value,
      knowledgeState: input.knowledgeState as KnowledgeState,
      assessmentState: input.assessmentState as AssessmentState,
      observedAt: typeof input.observedAt === "string" ? input.observedAt : null,
      recordedAt: nowIso(),
      validFrom: null,
      validTo: null,
    });
    if (!result.ok) errors.push(...result.errors);
  }
  if (toolName === "directory.propose_offering") {
    const result = validateOffering({
      id: "proposed",
      providerId: String(input.providerId ?? ""),
      serviceId: String(input.serviceId ?? ""),
      name: String(input.name ?? ""),
      status: typeof input.status === "string" ? input.status : null,
    });
    if (!result.ok) errors.push(...result.errors);
  }
  if (toolName === "directory.propose_location") {
    const precision = typeof input.mapPrecision === "string" ? input.mapPrecision : "undisclosed";
    const hasCoordinates = typeof input.lat === "number" && typeof input.lng === "number";
    if (
      precision === "facility_exact" &&
      !canAssignMapPrecision({
        requested: "facility_exact",
        evidenceKind: "city_name_only",
        hasCoordinates,
      })
    ) {
      errors.push("city-only location cannot request facility_exact");
    }
  }
  if (toolName === "directory.propose_facility") {
    const precision = typeof input.mapPrecision === "string" ? input.mapPrecision : "undisclosed";
    const result = validateFacility({
      id: "proposed",
      name: String(input.name ?? ""),
      locationId: typeof input.locationId === "string" ? input.locationId : null,
      address: typeof input.address === "string" ? input.address : null,
      operator: typeof input.operator === "string" ? input.operator : null,
      lat: typeof input.lat === "number" ? input.lat : null,
      lng: typeof input.lng === "number" ? input.lng : null,
      mapPrecision: precision as never,
    });
    if (!result.ok) errors.push(...result.errors);
  }
  if (toolName === "directory.propose_technology_deployment") {
    const result = validateTechnologyDeployment({
      id: "proposed",
      technologyId: String(input.technologyId ?? ""),
      technologyVersionId: typeof input.technologyVersionId === "string" ? input.technologyVersionId : null,
      scope: input.scope as never,
      scopeId: String(input.scopeId ?? ""),
      hasUniversalScopeEvidence: input.hasUniversalScopeEvidence === true,
    });
    if (!result.ok) errors.push(...result.errors);
  }
  if (toolName === "directory.propose_price_observation") {
    if (typeof input.amount === "number" && input.amount < 0) {
      errors.push("amount must not be negative");
    }
  }
  return errors;
}

export function isRejectedOutcome(value: unknown): value is RejectedOutcome {
  return (
    typeof value === "object" &&
    value !== null &&
    "outcome" in value &&
    (value as { outcome?: unknown }).outcome === OUTCOME.rejected
  );
}

export function validateProposalInput(toolName: string, input: unknown): RejectedOutcome | Record<string, unknown> {
  const contract = validateToolInput(toolName, input);
  if (!contract.ok) {
    return rejected(ERROR_CODE.malformedPayload, "malformed proposal payload", contract.errors);
  }
  const record = asRecord(input);
  if (!record) {
    return rejected(ERROR_CODE.malformedPayload, "malformed proposal payload");
  }
  const domainErrors = extraDomainErrors(toolName, record);
  if (domainErrors.length) {
    return rejected(ERROR_CODE.malformedPayload, "malformed proposal payload", domainErrors);
  }
  return record;
}

export async function submitProposal(
  repo: ProposalRepository,
  toolName: string,
  input: unknown,
  principalId: string
): Promise<ProposalSubmitResult> {
  const identity = rejectModelIdentity(input);
  if (identity) return identity;
  const principal = bindPrincipal(principalId);
  if (typeof principal !== "string") return principal;
  const validated = validateProposalInput(toolName, input);
  if (isRejectedOutcome(validated)) return validated;
  const idempotencyKey = String(validated.idempotencyKey);
  const digestBody = proposalBodyForDigest(toolName, validated);
  const digest = bodyDigest(digestBody);
  const existing = await repo.findByIdempotencyKey(idempotencyKey);
  if (existing) {
    if (existing.bodyDigest === digest) {
      return { outcome: OUTCOME.replayed, proposal: existing };
    }
    return rejected(
      ERROR_CODE.idempotencyConflict,
      "same idempotency key with an altered body is rejected"
    );
  }
  const now = nowIso();
  const row: ProposalRecord = {
    id: newProposalId(),
    toolName,
    actorId: principal,
    idempotencyKey,
    body: digestBody,
    bodyDigest: digest,
    status: "pending_review",
    createdAt: now,
    updatedAt: now,
  };
  const inserted = await repo.createProposalWithInitialRevision(row, {
    id: newProposalId(),
    proposalId: row.id,
    revisionOrdinal: 1,
    body: digestBody,
    bodyDigest: digest,
    actorId: principal,
    createdAt: now,
  });
  if (inserted === "inserted") {
    return { outcome: OUTCOME.created, proposal: row };
  }
  if (inserted === "conflict") {
    const raced = await repo.findByIdempotencyKey(idempotencyKey);
    if (raced && raced.bodyDigest === digest) {
      return { outcome: OUTCOME.replayed, proposal: raced };
    }
    if (raced) {
      return rejected(
        ERROR_CODE.idempotencyConflict,
        "same idempotency key with an altered body is rejected"
      );
    }
    return {
      outcome: OUTCOME.ambiguous,
      code: "commit_uncertain",
      message: "idempotency conflict could not be resolved to an existing proposal",
      idempotencyKey,
    };
  }
  const afterUncertain = await repo.findByIdempotencyKey(idempotencyKey);
  if (afterUncertain && afterUncertain.bodyDigest === digest) {
    return { outcome: OUTCOME.replayed, proposal: afterUncertain };
  }
  if (afterUncertain) {
    return rejected(
      ERROR_CODE.idempotencyConflict,
      "same idempotency key with an altered body is rejected"
    );
  }
  return {
    outcome: OUTCOME.ambiguous,
    code: "commit_uncertain",
    message: "proposal write was not confirmed; refusing a duplicate insert",
    idempotencyKey,
  };
}
