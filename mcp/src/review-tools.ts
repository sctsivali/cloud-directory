import { validateToolInput } from "../../packages/contracts/src/mcp.ts";
import { bodyDigest } from "./digest.ts";
import { ERROR_CODE, OUTCOME } from "./errors.ts";
import { bindPrincipal, rejectModelIdentity } from "./principal.ts";
import { isRejectedOutcome, validateRevisionReplacement } from "./proposal-tools.ts";
import { newProposalId, nowIso, statusForReviewDecision, type ProposalRepository } from "./store.ts";
import type { MutationResult, RejectedOutcome, ReviewRecord } from "./types.ts";

function rejected(code: string, message: string, errors?: string[]): RejectedOutcome {
  return { outcome: OUTCOME.rejected, code, message, errors };
}

function bindMutationIdentity(
  input: unknown,
  principalId: string
): RejectedOutcome | { principal: string; record: Record<string, unknown> } {
  const identity = rejectModelIdentity(input);
  if (identity) return identity;
  const principal = bindPrincipal(principalId);
  if (typeof principal !== "string") return principal;
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return rejected(ERROR_CODE.malformedPayload, "malformed payload");
  }
  return { principal, record: input as Record<string, unknown> };
}

function ambiguous(message: string, idempotencyKey: string): MutationResult {
  return {
    outcome: OUTCOME.ambiguous,
    code: "commit_uncertain",
    message,
    idempotencyKey,
  };
}

function writeRejection(write: string): RejectedOutcome | null {
  if (write === "not_found") return rejected(ERROR_CODE.notFound, "proposal not found");
  if (write === "self_approval") {
    return rejected(ERROR_CODE.selfApprovalForbidden, "proposal or revision author cannot self-approve");
  }
  if (write === "illegal_transition") {
    return rejected(ERROR_CODE.illegalStateTransition, "illegal proposal status transition");
  }
  return null;
}

export async function reviewProposal(
  repo: ProposalRepository,
  input: unknown,
  principalId: string
): Promise<MutationResult> {
  const bound = bindMutationIdentity(input, principalId);
  if (isRejectedOutcome(bound)) return bound;
  const contract = validateToolInput("directory.review_proposal", bound.record);
  if (!contract.ok) {
    return rejected(ERROR_CODE.malformedPayload, "malformed review payload", contract.errors);
  }
  const proposalId = String(bound.record.proposalId);
  const existing = await repo.findById(proposalId);
  if (!existing) {
    return rejected(ERROR_CODE.notFound, "proposal not found");
  }
  const now = nowIso();
  const review: ReviewRecord = {
    id: newProposalId(),
    proposalId,
    reviewerId: bound.principal,
    decision: bound.record.decision as "reject" | "request_changes",
    comment: typeof bound.record.comment === "string" ? bound.record.comment : null,
    createdAt: now,
    invalidatedAt: null,
  };
  const wrote = await repo.recordReviewAndStatus(review);
  const denial = writeRejection(wrote.write);
  if (denial) return denial;
  if (wrote.write === "uncertain") {
    const current = await repo.findById(proposalId);
    const reviews = await repo.listReviews(proposalId);
    const found = reviews.find((row) => row.id === review.id);
    if (found && current?.status === statusForReviewDecision(review.decision)) {
      return { outcome: OUTCOME.created, proposal: current, review: found };
    }
    return ambiguous(
      "review write was not confirmed; refusing a duplicate mutation",
      existing.idempotencyKey
    );
  }
  if (wrote.write !== "ok") {
    return ambiguous(
      "review write was not confirmed; refusing a duplicate mutation",
      existing.idempotencyKey
    );
  }
  return { outcome: OUTCOME.created, proposal: wrote.proposal, review: wrote.review };
}

export async function approveProposal(
  repo: ProposalRepository,
  input: unknown,
  principalId: string
): Promise<MutationResult> {
  const bound = bindMutationIdentity(input, principalId);
  if (isRejectedOutcome(bound)) return bound;
  const contract = validateToolInput("directory.approve_proposal", bound.record);
  if (!contract.ok) {
    return rejected(ERROR_CODE.malformedPayload, "malformed approval payload", contract.errors);
  }
  const proposalId = String(bound.record.proposalId);
  const existing = await repo.findById(proposalId);
  if (!existing) {
    return rejected(ERROR_CODE.notFound, "proposal not found");
  }
  if (existing.actorId === bound.principal) {
    return rejected(ERROR_CODE.selfApprovalForbidden, "proposal cannot self-approve");
  }
  const now = nowIso();
  const review: ReviewRecord = {
    id: newProposalId(),
    proposalId,
    reviewerId: bound.principal,
    decision: "approve",
    comment: typeof bound.record.comment === "string" ? bound.record.comment : null,
    createdAt: now,
    invalidatedAt: null,
    boundRevisionId: null,
    boundBodyDigest: null,
  };
  const wrote = await repo.recordReviewAndStatus(review);
  const denial = writeRejection(wrote.write);
  if (denial) return denial;
  if (wrote.write === "uncertain") {
    const current = await repo.findById(proposalId);
    const reviews = await repo.listReviews(proposalId);
    const found = reviews.find((row) => row.id === review.id);
    if (found && current?.status === "approved") {
      return { outcome: OUTCOME.created, proposal: current, review: found };
    }
    return ambiguous(
      "approval write was not confirmed; refusing a duplicate mutation",
      existing.idempotencyKey
    );
  }
  if (wrote.write !== "ok") {
    return ambiguous(
      "approval write was not confirmed; refusing a duplicate mutation",
      existing.idempotencyKey
    );
  }
  return { outcome: OUTCOME.created, proposal: wrote.proposal, review: wrote.review };
}

export async function reviseProposal(
  repo: ProposalRepository,
  input: unknown,
  principalId: string
): Promise<MutationResult> {
  const bound = bindMutationIdentity(input, principalId);
  if (isRejectedOutcome(bound)) return bound;
  const contract = validateToolInput("directory.revise_proposal", bound.record);
  if (!contract.ok) {
    return rejected(ERROR_CODE.malformedPayload, "malformed revision payload", contract.errors);
  }
  const proposalId = String(bound.record.proposalId);
  const existing = await repo.findById(proposalId);
  if (!existing) {
    return rejected(ERROR_CODE.notFound, "proposal not found");
  }
  const replacement = validateRevisionReplacement(existing.toolName, bound.record.body);
  if (isRejectedOutcome(replacement)) return replacement;
  const now = nowIso();
  const revisionId = newProposalId();
  const wrote = await repo.reviseInvalidateAndUpdate(
    {
      id: revisionId,
      proposalId,
      body: replacement,
      actorId: bound.principal,
      createdAt: now,
    },
    now
  );
  const denial = writeRejection(wrote.write);
  if (denial) return denial;
  if (wrote.write === "uncertain") {
    const current = await repo.findById(proposalId);
    const after = await repo.listRevisions(proposalId);
    const found = after.some((row) => row.id === revisionId);
    const digest = bodyDigest({ toolName: (current ?? existing).toolName, ...replacement });
    if (found && current?.status === "pending_review" && current.bodyDigest === digest) {
      return { outcome: OUTCOME.created, proposal: current };
    }
    return ambiguous(
      "revision write was not confirmed; refusing a duplicate mutation",
      existing.idempotencyKey
    );
  }
  if (wrote.write !== "ok") {
    return ambiguous(
      "revision write was not confirmed; refusing a duplicate mutation",
      existing.idempotencyKey
    );
  }
  return { outcome: OUTCOME.created, proposal: wrote.proposal };
}
