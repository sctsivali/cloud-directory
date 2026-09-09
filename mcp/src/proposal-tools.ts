import { validateToolInput } from "../../packages/contracts/src/mcp.ts";
import { validateProposalFields, validateReplacementBody } from "../../packages/domain/src/proposal-body.ts";
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

export function isRejectedOutcome(value: unknown): value is RejectedOutcome {
  return (
    typeof value === "object" &&
    value !== null &&
    "outcome" in value &&
    (value as { outcome?: unknown }).outcome === OUTCOME.rejected
  );
}

export function validateProposalInput(toolName: string, input: unknown): RejectedOutcome | Record<string, unknown> {
  const record = asRecord(input);
  if (!record) {
    return rejected(ERROR_CODE.malformedPayload, "malformed proposal payload");
  }
  const identity = rejectModelIdentity(record);
  if (identity) return identity;
  const validated = validateProposalFields(toolName, record);
  if (!validated.ok) {
    return rejected(ERROR_CODE.malformedPayload, "malformed proposal payload", validated.errors);
  }
  return record;
}

export function validateRevisionReplacement(
  toolName: string,
  body: unknown
): RejectedOutcome | Record<string, unknown> {
  const validated = validateReplacementBody(toolName, body);
  if (!validated.ok) {
    return rejected(ERROR_CODE.malformedPayload, "malformed revision payload", validated.errors);
  }
  if (!asRecord(body)) {
    return rejected(ERROR_CODE.malformedPayload, "malformed revision payload");
  }
  return body as Record<string, unknown>;
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
