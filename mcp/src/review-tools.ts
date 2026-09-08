import { validateToolInput } from "../../packages/contracts/src/mcp.ts";
import { bodyDigest } from "./digest.ts";
import { ERROR_CODE, OUTCOME } from "./errors.ts";
import { bindPrincipal, rejectModelIdentity } from "./principal.ts";
import { isRejectedOutcome } from "./proposal-tools.ts";
import { newProposalId, nowIso, type ProposalRepository } from "./store.ts";
import type { MutationResult, ProposalRecord, RejectedOutcome, ReviewRecord } from "./types.ts";

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
  const proposal = await repo.findById(String(bound.record.proposalId));
  if (!proposal) {
    return rejected(ERROR_CODE.notFound, "proposal not found");
  }
  const now = nowIso();
  const review: ReviewRecord = {
    id: newProposalId(),
    proposalId: proposal.id,
    reviewerId: bound.principal,
    decision: bound.record.decision as "reject" | "request_changes",
    comment: typeof bound.record.comment === "string" ? bound.record.comment : null,
    createdAt: now,
    invalidatedAt: null,
  };
  const status = review.decision === "reject" ? "rejected" : "changes_requested";
  const updated: ProposalRecord = { ...proposal, status, updatedAt: now };
  const wrote = await repo.recordReviewAndStatus(review, updated);
  if (wrote === "uncertain") {
    const current = await repo.findById(proposal.id);
    const reviews = await repo.listReviews(proposal.id);
    const found = reviews.find((row) => row.id === review.id);
    if (found && current?.status === updated.status) {
      return { outcome: OUTCOME.created, proposal: current, review: found };
    }
    return ambiguous(
      "review write was not confirmed; refusing a duplicate mutation",
      proposal.idempotencyKey
    );
  }
  return { outcome: OUTCOME.created, proposal: updated, review };
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
  const proposal = await repo.findById(String(bound.record.proposalId));
  if (!proposal) {
    return rejected(ERROR_CODE.notFound, "proposal not found");
  }
  if (proposal.actorId === bound.principal) {
    return rejected(ERROR_CODE.selfApprovalForbidden, "proposal cannot self-approve");
  }
  const now = nowIso();
  const review: ReviewRecord = {
    id: newProposalId(),
    proposalId: proposal.id,
    reviewerId: bound.principal,
    decision: "approve",
    comment: typeof bound.record.comment === "string" ? bound.record.comment : null,
    createdAt: now,
    invalidatedAt: null,
  };
  const updated: ProposalRecord = { ...proposal, status: "approved", updatedAt: now };
  const wrote = await repo.recordReviewAndStatus(review, updated);
  if (wrote === "uncertain") {
    const current = await repo.findById(proposal.id);
    const reviews = await repo.listReviews(proposal.id);
    const found = reviews.find((row) => row.id === review.id);
    if (found && current?.status === "approved") {
      return { outcome: OUTCOME.created, proposal: current, review: found };
    }
    return ambiguous(
      "approval write was not confirmed; refusing a duplicate mutation",
      proposal.idempotencyKey
    );
  }
  return { outcome: OUTCOME.created, proposal: updated, review };
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
  const proposal = await repo.findById(String(bound.record.proposalId));
  if (!proposal) {
    return rejected(ERROR_CODE.notFound, "proposal not found");
  }
  const body = bound.record.body as Record<string, unknown>;
  const digest = bodyDigest({ toolName: proposal.toolName, ...body });
  const now = nowIso();
  const revisions = await repo.listRevisions(proposal.id);
  const ordinal = revisions.reduce((max, row) => Math.max(max, row.revisionOrdinal), 0) + 1;
  const revision = {
    id: newProposalId(),
    proposalId: proposal.id,
    revisionOrdinal: ordinal,
    body,
    bodyDigest: digest,
    actorId: bound.principal,
    createdAt: now,
  };
  const updated: ProposalRecord = {
    ...proposal,
    body: { toolName: proposal.toolName, ...body },
    bodyDigest: digest,
    status: "pending_review",
    updatedAt: now,
  };
  const wrote = await repo.reviseInvalidateAndUpdate(revision, updated, now);
  if (wrote === "uncertain") {
    const current = await repo.findById(proposal.id);
    const after = await repo.listRevisions(proposal.id);
    const found = after.some((row) => row.id === revision.id);
    if (found && current?.status === "pending_review" && current.bodyDigest === digest) {
      return { outcome: OUTCOME.created, proposal: current };
    }
    return ambiguous(
      "revision write was not confirmed; refusing a duplicate mutation",
      proposal.idempotencyKey
    );
  }
  return { outcome: OUTCOME.created, proposal: updated };
}
