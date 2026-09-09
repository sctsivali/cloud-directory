import { approvalDigest, bodyDigestFromValue } from "../src/revisions/digest.ts";
import type { MemoryPublicationStore } from "../src/revisions/memory.ts";
import type { ProposalSnapshot, ReviewSnapshot, RevisionSnapshot } from "../src/revisions/types.ts";

export function seedApprovedProposal(
  store: MemoryPublicationStore,
  opts: {
    proposalId: string;
    toolName: string;
    body: Record<string, unknown>;
    actorId?: string;
    reviewerId?: string;
  }
) {
  const now = "2026-09-09T04:00:00.000Z";
  const body = { toolName: opts.toolName, ...opts.body };
  const digest = bodyDigestFromValue(body);
  const proposal: ProposalSnapshot = {
    id: opts.proposalId,
    toolName: opts.toolName,
    actorId: opts.actorId ?? "worker-a",
    idempotencyKey: `${opts.proposalId}-key`,
    body,
    bodyDigest: digest,
    status: "approved",
    createdAt: now,
    updatedAt: now,
  };
  const revision: RevisionSnapshot = {
    id: `${proposal.id}-rev-1`,
    proposalId: proposal.id,
    revisionOrdinal: 1,
    body,
    bodyDigest: digest,
    actorId: proposal.actorId,
    createdAt: now,
  };
  const review: ReviewSnapshot = {
    id: `${proposal.id}-appr-1`,
    proposalId: proposal.id,
    reviewerId: opts.reviewerId ?? "editor-1",
    decision: "approve",
    comment: "ok",
    createdAt: "2026-09-09T05:00:00.000Z",
    invalidatedAt: null,
    boundRevisionId: revision.id,
    boundBodyDigest: digest,
  };
  store.seedProposal(proposal, revision, review);
  const storedProposal = store.proposals.get(proposal.id)!;
  const storedRevision = store.revisions.find((row) => row.id === revision.id)!;
  const storedReview = store.reviews.find((row) => row.id === review.id)!;
  return {
    proposal: storedProposal,
    revision: storedRevision,
    review: storedReview,
    approvalDigest: approvalDigest(storedReview),
  };
}

export function seedApprovedClaim(
  store: MemoryPublicationStore,
  opts?: {
    proposalId?: string;
    actorId?: string;
    reviewerId?: string;
    value?: unknown;
    subjectType?: string;
    subjectId?: string;
    claimType?: string;
  }
) {
  return seedApprovedProposal(store, {
    proposalId: opts?.proposalId ?? "prop-1",
    toolName: "directory.propose_claim",
    actorId: opts?.actorId,
    reviewerId: opts?.reviewerId,
    body: {
      subjectType: opts?.subjectType ?? "provider",
      subjectId: opts?.subjectId ?? "local-packages",
      claimType: opts?.claimType ?? "hypervisor",
      value: opts?.value ?? { text: "KVM" },
      knowledgeState: "present",
      assessmentState: "independently_verified",
      observedAt: "2026-09-01T00:00:00.000Z",
      snapshotId: "snap-1",
    },
  });
}
