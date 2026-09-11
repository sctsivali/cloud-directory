import { approvalDigest, newLedgerId, publicationRequestDigest } from "./digest.ts";
import { collectSupersessionAncestors, validateRollbackBindings } from "./rollback.ts";
import { deriveSubject } from "./subject.ts";
import { attemptIdentityEqual, publicationReplayAllowed } from "./attempts.ts";
import { validateStoredProposalBody } from "../proposal-body.ts";
import {
  PUBLICATION_ERROR,
  type PreparedPublication,
  type PublicationAttempt,
  type PublicationOutcome,
  type PublicationStore,
  type PublishRequest,
  type PublishWriteResult,
  type ProposalSnapshot,
  type ReviewSnapshot,
  type RevisionSnapshot,
} from "./types.ts";

function rejectedOutcome(
  code: (typeof PUBLICATION_ERROR)[keyof typeof PUBLICATION_ERROR],
  message: string
): PublicationOutcome {
  return { outcome: "rejected", code, message };
}

function ambiguous(idempotencyKey: string, attemptId?: string): PublicationOutcome {
  return {
    outcome: "ambiguous",
    code: "commit_uncertain",
    message: "publication commit was not confirmed; refusing a duplicate mutation",
    idempotencyKey,
    attemptId,
  };
}

export function validApproval(reviews: ReviewSnapshot[]): ReviewSnapshot | null {
  const approved = reviews.filter((row) => row.decision === "approve" && row.invalidatedAt == null);
  return approved[approved.length - 1] ?? null;
}

export function validatePublishBindings(args: {
  request: PublishRequest;
  proposal: { id: string; actorId: string; bodyDigest: string; status: string; toolName?: string; body?: Record<string, unknown> };
  revision: { id: string; proposalId: string; bodyDigest: string; actorId?: string };
  approval: ReviewSnapshot | null;
}): PublicationOutcome | null {
  if (
    args.request.publisherPrincipal === args.proposal.actorId ||
    args.request.publisherPrincipal === args.revision.actorId
  ) {
    return rejectedOutcome(PUBLICATION_ERROR.selfPublishForbidden, "proposal or revision author cannot publish own revision");
  }
  if (args.proposal.toolName && args.proposal.body) {
    const bodyCheck = validateStoredProposalBody(args.proposal.toolName, args.proposal.body);
    if (!bodyCheck.ok) {
      return rejectedOutcome(PUBLICATION_ERROR.malformedPayload, "published body failed original tool validation");
    }
  }
  if (args.proposal.status !== "approved" && args.proposal.status !== "published") {
    return rejectedOutcome(PUBLICATION_ERROR.approvalInvalid, "proposal is not approved");
  }
  if (!args.approval) {
    return rejectedOutcome(PUBLICATION_ERROR.approvalInvalid, "approval is no longer valid");
  }
  if (args.revision.proposalId !== args.proposal.id) {
    return rejectedOutcome(PUBLICATION_ERROR.revisionMismatch, "revision is not bound to the proposal");
  }
  if (args.request.expectedRevisionId !== args.revision.id) {
    return rejectedOutcome(PUBLICATION_ERROR.revisionMismatch, "expected revision does not match");
  }
  if (
    args.request.expectedBodyDigest !== args.proposal.bodyDigest ||
    args.request.expectedBodyDigest !== args.revision.bodyDigest
  ) {
    return rejectedOutcome(PUBLICATION_ERROR.revisionMismatch, "expected body digest does not match");
  }
  if (
    args.approval.boundRevisionId !== args.revision.id ||
    args.approval.boundBodyDigest !== args.revision.bodyDigest
  ) {
    return rejectedOutcome(PUBLICATION_ERROR.staleApproval, "approval is not bound to the exact revision");
  }
  return null;
}

export function revalidateLockedPublication(args: {
  plan: PreparedPublication;
  proposal: ProposalSnapshot | null;
  revision: RevisionSnapshot | null;
  reviews: ReviewSnapshot[];
}): PublishWriteResult | null {
  if (!args.proposal) {
    return { write: "rejected", code: PUBLICATION_ERROR.notFound, message: "proposal not found" };
  }
  if (!args.revision) {
    return {
      write: "rejected",
      code: PUBLICATION_ERROR.revisionMismatch,
      message: "revision not found",
    };
  }
  if (args.plan.publisherPrincipal === args.proposal.actorId || args.plan.publisherPrincipal === args.revision.actorId) {
    return { write: "self_publish" };
  }
  const approval = validApproval(args.reviews);
  const request: PublishRequest = {
    proposalId: args.proposal.id,
    expectedRevisionId: args.plan.revision.id,
    expectedBodyDigest: args.plan.revision.bodyDigest,
    expectedCanonicalDigest: args.plan.expectedCanonicalDigest,
    idempotencyKey: args.plan.idempotencyKey,
    methodologyVersion: args.plan.methodologyVersion,
    dataRevision: args.plan.dataRevision,
    publisherPrincipal: args.plan.publisherPrincipal,
  };
  const binding = validatePublishBindings({
    request,
    proposal: args.proposal,
    revision: args.revision,
    approval,
  });
  if (binding && binding.outcome === "rejected") {
    return { write: "rejected", code: binding.code, message: binding.message };
  }
  if (args.proposal.bodyDigest !== args.plan.revision.bodyDigest) {
    return {
      write: "rejected",
      code: PUBLICATION_ERROR.revisionMismatch,
      message: "proposal body digest changed after prevalidation",
    };
  }
  if (args.revision.bodyDigest !== args.plan.revision.bodyDigest || args.revision.id !== args.plan.revision.id) {
    return {
      write: "rejected",
      code: PUBLICATION_ERROR.revisionMismatch,
      message: "revision does not match the publication plan",
    };
  }
  return null;
}

export async function publishRevision(
  store: PublicationStore,
  request: PublishRequest
): Promise<PublicationOutcome> {
  if (!Object.prototype.hasOwnProperty.call(request, "expectedCanonicalDigest") ||
      (request.expectedCanonicalDigest !== null &&
       (typeof request.expectedCanonicalDigest !== "string" || !request.expectedCanonicalDigest.trim()))) {
    return rejectedOutcome(PUBLICATION_ERROR.malformedPayload, "expectedCanonicalDigest must be explicit: null for absence or a non-empty digest");
  }
  if (!request.proposalId || !request.expectedRevisionId || !request.expectedBodyDigest || !request.idempotencyKey) {
    return rejectedOutcome(PUBLICATION_ERROR.malformedPayload, "publication request is incomplete");
  }
  const requestDigest = publicationRequestDigest(request);
  const incomingIdentity = {
    requestDigest,
    proposalId: request.proposalId,
    revisionId: request.expectedRevisionId,
    publisherId: request.publisherPrincipal,
  };
  const existingReceipt = await store.findReceiptByIdempotencyKey(request.idempotencyKey);
  if (existingReceipt) {
    const existingAttempt = await store.findAttemptByIdempotencyKey(request.idempotencyKey);
    if (!publicationReplayAllowed({ receipt: existingReceipt, attempt: existingAttempt, incoming: incomingIdentity })) {
      return rejectedOutcome(PUBLICATION_ERROR.idempotencyConflict, "same idempotency key with an altered publication request");
    }
    const event = await store.findEventByReceiptId(existingReceipt.id);
    if (!event) {
      return ambiguous(request.idempotencyKey, existingAttempt?.id);
    }
    return { outcome: "replayed", receipt: existingReceipt, event };
  }
  const existingAttempt = await store.findAttemptByIdempotencyKey(request.idempotencyKey);
  if (existingAttempt && !attemptIdentityEqual(existingAttempt, incomingIdentity)) {
    return rejectedOutcome(PUBLICATION_ERROR.idempotencyConflict, "same idempotency key with an altered publication request");
  }
  if (existingAttempt && (existingAttempt.state === "uncertain" || existingAttempt.state === "pending")) {
    const laterReceipt = await store.findReceiptByIdempotencyKey(request.idempotencyKey);
    if (laterReceipt) {
      const event = await store.findEventByReceiptId(laterReceipt.id);
      if (event && publicationReplayAllowed({ receipt: laterReceipt, attempt: existingAttempt, incoming: incomingIdentity })) {
        return { outcome: "replayed", receipt: laterReceipt, event };
      }
      if (laterReceipt && !publicationReplayAllowed({ receipt: laterReceipt, attempt: existingAttempt, incoming: incomingIdentity })) {
        return rejectedOutcome(PUBLICATION_ERROR.idempotencyConflict, "same idempotency key with an altered publication request");
      }
    }
    return ambiguous(request.idempotencyKey, existingAttempt.id);
  }

  const proposal = await store.findProposal(request.proposalId);
  if (!proposal) return rejectedOutcome(PUBLICATION_ERROR.notFound, "proposal not found");
  const revision = await store.findRevision(request.expectedRevisionId);
  if (!revision) return rejectedOutcome(PUBLICATION_ERROR.revisionMismatch, "revision not found");
  const reviews = await store.listReviews(proposal.id);
  const approval = validApproval(reviews);
  const binding = validatePublishBindings({ request, proposal, revision, approval });
  if (binding) return binding;

  const subject = deriveSubject(proposal, revision, request.rollbackOfReceiptId ?? null);
  const current = await store.getCanonicalState(subject.entityType, subject.entityId, subject.fieldName);
  const currentDigest = current?.valueDigest ?? null;
  const expectedDigest = request.expectedCanonicalDigest;
  if ((expectedDigest ?? null) !== (currentDigest ?? null)) {
    const racedReceipt = await store.findReceiptByIdempotencyKey(request.idempotencyKey);
    if (racedReceipt) {
      const racedAttempt = await store.findAttemptByIdempotencyKey(request.idempotencyKey);
      if (!publicationReplayAllowed({ receipt: racedReceipt, attempt: racedAttempt, incoming: incomingIdentity })) {
        return rejectedOutcome(PUBLICATION_ERROR.idempotencyConflict, "same idempotency key with an altered publication request");
      }
      const racedEvent = await store.findEventByReceiptId(racedReceipt.id);
      if (!racedEvent) {
        return ambiguous(request.idempotencyKey, racedAttempt?.id);
      }
      return { outcome: "replayed", receipt: racedReceipt, event: racedEvent };
    }
    return rejectedOutcome(PUBLICATION_ERROR.casConflict, "canonical state does not match expected digest");
  }

  let correctionOfEventId: string | null = null;
  let supersedesReceiptId: string | null = null;
  let changeType = subject.changeType;
  let afterValue: unknown = subject.afterValue;
  let beforeValue: unknown = current?.value ?? null;
  if (request.rollbackOfReceiptId) {
    const original = await store.findReceiptById(request.rollbackOfReceiptId);
    if (!original) return rejectedOutcome(PUBLICATION_ERROR.notFound, "original publication receipt not found");
    const originalEvent = await store.findEventByReceiptId(original.id);
    const superseding = await store.findReceiptsSuperseding(original.id);
    const ancestors = await collectSupersessionAncestors(store, original);
    const rollback = validateRollbackBindings({
      original,
      originalEvent,
      target: {
        entityType: subject.entityType,
        entityId: subject.entityId,
        fieldName: subject.fieldName,
      },
      currentDigest,
      superseding,
      ancestors,
    });
    if (rollback) return rollback;
    correctionOfEventId = originalEvent?.id ?? null;
    supersedesReceiptId = original.id;
    changeType = "rollback";
    afterValue = original.beforeValue;
    beforeValue = original.afterValue;
  }

  const now = new Date().toISOString();
  const attemptId = existingAttempt?.id ?? newLedgerId("att");
  const plan: PreparedPublication = {
    knowledgeState: subject.knowledgeState,
    assessmentState: subject.assessmentState,
    attemptId,
    receiptId: newLedgerId("rcpt"),
    eventId: newLedgerId("evt"),
    requestDigest,
    proposal,
    revision,
    approval: approval!,
    approvalDigest: approvalDigest(approval!),
    publisherPrincipal: request.publisherPrincipal,
    idempotencyKey: request.idempotencyKey,
    methodologyVersion: request.methodologyVersion,
    dataRevision: request.dataRevision,
    evidenceSnapshotIds: subject.evidenceSnapshotIds,
    beforeValue,
    afterValue,
    expectedCanonicalDigest: request.expectedCanonicalDigest,
    entityType: subject.entityType,
    entityId: subject.entityId,
    fieldName: subject.fieldName,
    changeType,
    valueSensitivity: subject.valueSensitivity,
    sourceId: subject.sourceId,
    detectedAt: proposal.createdAt,
    observedAt: subject.observedAt,
    reviewedAt: approval!.createdAt,
    publishedAt: now,
    titleId: subject.titleId,
    titleEn: subject.titleEn,
    summaryId: subject.summaryId,
    summaryEn: subject.summaryEn,
    providerId: subject.providerId,
    href: subject.href,
    correctionOfEventId,
    supersedesReceiptId,
    verificationState: "pending",
  };

  const wrote = await store.commitPublication(plan);
  if (wrote.write === "ok") return { outcome: "created", receipt: wrote.receipt, event: wrote.event };
  if (wrote.write === "replayed") return { outcome: "replayed", receipt: wrote.receipt, event: wrote.event };
  if (wrote.write === "rejected") return rejectedOutcome(wrote.code, wrote.message);
  if (wrote.write === "cas_conflict") {
    return rejectedOutcome(PUBLICATION_ERROR.casConflict, "canonical state changed during publish");
  }
  if (wrote.write === "self_publish") {
    return rejectedOutcome(PUBLICATION_ERROR.selfPublishForbidden, "proposal or revision author cannot publish own revision");
  }

  const afterReceipt = await store.findReceiptByIdempotencyKey(request.idempotencyKey);
  if (afterReceipt) {
    const event = await store.findEventByReceiptId(afterReceipt.id);
    const afterAttempt = await store.findAttemptByIdempotencyKey(request.idempotencyKey);
    if (
      event &&
      publicationReplayAllowed({
        receipt: afterReceipt,
        attempt: afterAttempt,
        incoming: incomingIdentity,
      })
    ) {
      return { outcome: "replayed", receipt: afterReceipt, event };
    }
    if (event) {
      return rejectedOutcome(PUBLICATION_ERROR.idempotencyConflict, "same idempotency key with an altered publication request");
    }
  }
  const attempt: PublicationAttempt = {
    id: attemptId,
    idempotencyKey: request.idempotencyKey,
    requestDigest,
    proposalId: request.proposalId,
    revisionId: request.expectedRevisionId,
    publisherId: request.publisherPrincipal,
    state: "uncertain",
    createdAt: now,
    updatedAt: now,
  };
  try {
    await store.recordUncertainAttempt(attempt);
  } catch {
    // best-effort durability; outcome stays ambiguous
  }
  return ambiguous(request.idempotencyKey, attemptId);
}

export function isPublicationOutcome(value: unknown): value is PublicationOutcome {
  return Boolean(value && typeof value === "object" && "outcome" in value);
}

export async function rollbackPublication(
  store: PublicationStore,
  request: Omit<PublishRequest, "rollbackOfReceiptId"> & { originalReceiptId: string }
): Promise<PublicationOutcome> {
  return publishRevision(store, {
    ...request,
    rollbackOfReceiptId: request.originalReceiptId,
  });
}

