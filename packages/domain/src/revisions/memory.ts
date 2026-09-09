import { applyUncertainAttempt, attemptIdentityEqual, publicationReplayAllowed, verificationReplayAllowed, verificationStateAllowed } from "./attempts.ts";
import { bodyDigestFromValue } from "./digest.ts";
import { effectiveChangeType } from "./state.ts";
import { revalidateLockedPublication } from "./publish.ts";
import { validateRollbackBindings } from "./rollback.ts";
import { judgeVerification } from "./verify.ts";
import type {
  CanonicalState,
  ChangeEvent,
  PreparedPublication,
  PreparedVerification,
  PublicationAttempt,
  PublicationReceipt,
  PublicationStore,
  PublishWriteResult,
  ProposalSnapshot,
  ReviewSnapshot,
  RevisionSnapshot,
  VerifyWriteResult,
} from "./types.ts";
import { PUBLICATION_ERROR } from "./types.ts";

type Snapshot = {
  proposals: Map<string, ProposalSnapshot>;
  revisions: RevisionSnapshot[];
  reviews: ReviewSnapshot[];
  attempts: PublicationAttempt[];
  receipts: PublicationReceipt[];
  events: ChangeEvent[];
  canonical: Map<string, CanonicalState>;
};

function canonicalKey(entityType: string, entityId: string, fieldName: string): string {
  return `${entityType}\0${entityId}\0${fieldName}`;
}

function cloneProposal(row: ProposalSnapshot): ProposalSnapshot {
  return { ...row, body: { ...row.body } };
}

export class MemoryPublicationStore implements PublicationStore {
  proposals = new Map<string, ProposalSnapshot>();
  revisions: RevisionSnapshot[] = [];
  reviews: ReviewSnapshot[] = [];
  attempts: PublicationAttempt[] = [];
  receipts: PublicationReceipt[] = [];
  events: ChangeEvent[] = [];
  canonical = new Map<string, CanonicalState>();
  failAfterWrites: number | null = null;
  beforeCommit: (() => void | Promise<void>) | null = null;
  beforeVerification: (() => void | Promise<void>) | null = null;

  seedProposal(proposal: ProposalSnapshot, revision: RevisionSnapshot, review: ReviewSnapshot): void {
    this.proposals.set(proposal.id, cloneProposal(proposal));
    this.revisions.push({ ...revision, body: { ...revision.body } });
    this.reviews.push({ ...review });
  }

  invalidateApprovals(proposalId: string, at: string): void {
    for (const row of this.reviews) {
      if (row.proposalId === proposalId && row.decision === "approve" && row.invalidatedAt == null) {
        row.invalidatedAt = at;
      }
    }
  }

  canonicalDigest(entityType: string, entityId: string, fieldName: string): string | null {
    return this.canonical.get(canonicalKey(entityType, entityId, fieldName))?.valueDigest ?? null;
  }

  canonicalValue(entityType: string, entityId: string, fieldName: string): unknown {
    return this.canonical.get(canonicalKey(entityType, entityId, fieldName))?.value ?? null;
  }

  async findProposal(id: string): Promise<ProposalSnapshot | null> {
    const row = this.proposals.get(id);
    return row ? cloneProposal(row) : null;
  }

  async findRevision(id: string): Promise<RevisionSnapshot | null> {
    const row = this.revisions.find((item) => item.id === id);
    return row ? { ...row, body: { ...row.body } } : null;
  }

  async listRevisions(proposalId: string): Promise<RevisionSnapshot[]> {
    return this.revisions
      .filter((row) => row.proposalId === proposalId)
      .map((row) => ({ ...row, body: { ...row.body } }));
  }

  async listReviews(proposalId: string): Promise<ReviewSnapshot[]> {
    return this.reviews.filter((row) => row.proposalId === proposalId).map((row) => ({ ...row }));
  }

  async findReceiptByIdempotencyKey(key: string): Promise<PublicationReceipt | null> {
    return this.receipts.find((row) => row.idempotencyKey === key) ?? null;
  }

  async findAttemptByIdempotencyKey(key: string): Promise<PublicationAttempt | null> {
    return this.attempts.find((row) => row.idempotencyKey === key) ?? null;
  }

  async findReceiptById(id: string): Promise<PublicationReceipt | null> {
    return this.receipts.find((row) => row.id === id) ?? null;
  }

  async findEventByReceiptId(receiptId: string): Promise<ChangeEvent | null> {
    return this.events.find((row) => row.receiptId === receiptId) ?? null;
  }

  async findReceiptsSuperseding(receiptId: string): Promise<PublicationReceipt[]> {
    return this.receipts.filter((row) => row.supersedesReceiptId === receiptId);
  }

  async getCanonicalState(
    entityType: string,
    entityId: string,
    fieldName: string
  ): Promise<CanonicalState | null> {
    return this.canonical.get(canonicalKey(entityType, entityId, fieldName)) ?? null;
  }

  async recordUncertainAttempt(attempt: PublicationAttempt): Promise<void> {
    const existing = this.attempts.find((row) => row.idempotencyKey === attempt.idempotencyKey);
    const applied = applyUncertainAttempt(existing, attempt);
    if (!existing) {
      this.attempts.push(applied.attempt);
      return;
    }
    if (!applied.changed) return;
    existing.state = applied.attempt.state;
    existing.updatedAt = applied.attempt.updatedAt;
  }

  async commitPublication(plan: PreparedPublication): Promise<PublishWriteResult> {
    if (this.beforeCommit) await this.beforeCommit();
    return this.atomically<PublishWriteResult>(() => {
      const proposal = this.proposals.get(plan.proposal.id);
      const revision = this.revisions.find((row) => row.id === plan.revision.id) ?? null;
      const reviews = this.reviews.filter((row) => row.proposalId === plan.proposal.id);
      const locked = revalidateLockedPublication({
        plan,
        proposal: proposal ? cloneProposal(proposal) : null,
        revision: revision ? { ...revision, body: { ...revision.body } } : null,
        reviews: reviews.map((row) => ({ ...row })),
      });
      if (locked) return locked;
      if (!proposal) return { write: "rejected", code: "not_found", message: "proposal not found" };
      const key = canonicalKey(plan.entityType, plan.entityId, plan.fieldName);
      const current = this.canonical.get(key);
      const currentDigest = current?.valueDigest ?? null;
      if ((plan.expectedCanonicalDigest ?? null) !== currentDigest) {
        return { write: "cas_conflict" };
      }
      if (plan.changeType === "rollback" && plan.supersedesReceiptId) {
        const original = this.receipts.find((row) => row.id === plan.supersedesReceiptId);
        if (!original) {
          return { write: "rejected", code: PUBLICATION_ERROR.notFound, message: "original publication receipt not found" };
        }
        const originalEvent = this.events.find((row) => row.receiptId === original.id) ?? null;
        const superseding = this.receipts.filter((row) => row.supersedesReceiptId === original.id);
        const seen = new Set<string>([original.id]);
        const ancestors: PublicationReceipt[] = [];
        let cursor = original.supersedesReceiptId;
        let cycle = false;
        while (cursor) {
          if (seen.has(cursor)) {
            cycle = true;
            break;
          }
          seen.add(cursor);
          const row = this.receipts.find((item) => item.id === cursor);
          if (!row) {
            cycle = true;
            break;
          }
          ancestors.push(row);
          cursor = row.supersedesReceiptId;
        }
        const rollback = validateRollbackBindings({
          original,
          originalEvent,
          target: { entityType: plan.entityType, entityId: plan.entityId, fieldName: plan.fieldName },
          currentDigest,
          superseding,
          ancestors: cycle ? null : ancestors,
        });
        if (rollback && rollback.outcome === "rejected") {
          return { write: "rejected", code: rollback.code, message: rollback.message };
        }
      }
      const existing = this.receipts.find((row) => row.idempotencyKey === plan.idempotencyKey);
      const incomingIdentity = {
        requestDigest: plan.requestDigest,
        proposalId: plan.proposal.id,
        revisionId: plan.revision.id,
        publisherId: plan.publisherPrincipal,
      };
      if (existing) {
        const event = this.events.find((row) => row.receiptId === existing.id);
        const existingAttempt = this.attempts.find((row) => row.idempotencyKey === plan.idempotencyKey) ?? null;
        if (event && publicationReplayAllowed({ receipt: existing, attempt: existingAttempt, incoming: incomingIdentity })) {
          return { write: "replayed", receipt: existing, event };
        }
        return {
          write: "rejected",
          code: PUBLICATION_ERROR.idempotencyConflict,
          message: "same idempotency key with an altered publication request",
        };
      }
      const now = plan.publishedAt;
      const existingAttempt = this.attempts.find((row) => row.idempotencyKey === plan.idempotencyKey);
      if (existingAttempt && !attemptIdentityEqual(existingAttempt, {
        requestDigest: plan.requestDigest,
        proposalId: plan.proposal.id,
        revisionId: plan.revision.id,
        publisherId: plan.publisherPrincipal,
      })) {
        return {
          write: "rejected",
          code: PUBLICATION_ERROR.idempotencyConflict,
          message: "same idempotency key with an altered publication request",
        };
      }
      if (!existingAttempt) {
        this.attempts.push({
          id: plan.attemptId,
          idempotencyKey: plan.idempotencyKey,
          requestDigest: plan.requestDigest,
          proposalId: plan.proposal.id,
          revisionId: plan.revision.id,
          publisherId: plan.publisherPrincipal,
          state: "pending",
          createdAt: now,
          updatedAt: now,
        });
        this.afterWrite();
      }
      const afterDigest = bodyDigestFromValue(plan.afterValue);
      plan = { ...plan, changeType: effectiveChangeType(this.canonical.get(key) ?? null, plan) };
      this.canonical.set(key, {
        entityType: plan.entityType,
        entityId: plan.entityId,
        fieldName: plan.fieldName,
        value: plan.afterValue,
        knowledgeState: plan.knowledgeState ?? "unknown",
        assessmentState: plan.assessmentState ?? "legacy/unverified",
        valueDigest: afterDigest,
        dataRevision: plan.dataRevision,
        updatedAt: now,
      });
      this.afterWrite();
      const receipt: PublicationReceipt = {
        id: plan.receiptId,
        attemptId: existingAttempt?.id ?? plan.attemptId,
        proposalId: plan.proposal.id,
        revisionId: plan.revision.id,
        revisionOrdinal: plan.revision.revisionOrdinal,
        bodyDigest: plan.revision.bodyDigest,
        approvalId: plan.approval.id,
        approvalDigest: plan.approvalDigest,
        reviewerId: plan.approval.reviewerId,
        publisherId: plan.publisherPrincipal,
        methodologyVersion: plan.methodologyVersion,
        dataRevision: plan.dataRevision,
        idempotencyKey: plan.idempotencyKey,
        evidenceSnapshotIds: [...plan.evidenceSnapshotIds],
        beforeValue: plan.beforeValue,
        afterValue: plan.afterValue,
        entityType: plan.entityType,
        entityId: plan.entityId,
        fieldName: plan.fieldName,
        changeType: plan.changeType,
        knowledgeState: plan.knowledgeState ?? "unknown",
        assessmentState: plan.assessmentState ?? "legacy/unverified",
        verificationState: plan.verificationState,
        publishedAt: now,
        supersedesReceiptId: plan.supersedesReceiptId,
        verifiedBy: null,
        verifiedAt: null,
      };
      this.receipts.push(receipt);
      this.afterWrite();
      const event: ChangeEvent = {
        id: plan.eventId,
        receiptId: receipt.id,
        revisionId: plan.revision.id,
        proposalId: plan.proposal.id,
        changeType: plan.changeType,
        entityType: plan.entityType,
        entityId: plan.entityId,
        fieldName: plan.fieldName,
        oldValue: plan.beforeValue,
        knowledgeState: plan.knowledgeState ?? "unknown",
        assessmentState: plan.assessmentState ?? "legacy/unverified",
        newValue: plan.afterValue,
        valueSensitivity: plan.valueSensitivity,
        sourceId: plan.sourceId,
        evidenceSnapshotIds: [...plan.evidenceSnapshotIds],
        detectedAt: plan.detectedAt,
        observedAt: plan.observedAt,
        reviewedAt: plan.reviewedAt,
        publishedAt: now,
        correctionOfEventId: plan.correctionOfEventId,
        titleId: plan.titleId,
        titleEn: plan.titleEn,
        summaryId: plan.summaryId,
        summaryEn: plan.summaryEn,
        providerId: plan.providerId,
        href: plan.href,
      };
      this.events.push(event);
      this.afterWrite();
      const attempt = this.attempts.find((row) => row.idempotencyKey === plan.idempotencyKey);
      if (attempt) {
        if (!attemptStateCommitted(attempt.state)) {
          attempt.state = "committed";
        }
        attempt.updatedAt = now;
      }
      proposal.status = "published";
      proposal.updatedAt = now;
      return { write: "ok", receipt, event };
    }, { write: "uncertain" });
  }

  async commitVerification(plan: PreparedVerification): Promise<VerifyWriteResult> {
    if (this.beforeVerification) await this.beforeVerification();
    return this.atomically<VerifyWriteResult>(() => {
      const receipt = this.receipts.find((row) => row.id === plan.receiptId);
      if (!receipt) {
        return { write: "rejected", code: PUBLICATION_ERROR.notFound, message: "publication receipt not found" };
      }
      if (plan.verifierPrincipal === receipt.publisherId) return { write: "self_verify" };
      const proposal = this.proposals.get(receipt.proposalId);
      const revision = this.revisions.find((row) => row.id === receipt.revisionId);
      if (
        plan.verifierPrincipal === proposal?.actorId ||
        plan.verifierPrincipal === revision?.actorId
      ) {
        return { write: "self_verify" };
      }
      const event = this.events.find((row) => row.receiptId === receipt.id) ?? null;
      const canonical = this.canonical.get(canonicalKey(receipt.entityType, receipt.entityId, receipt.fieldName)) ?? null;
      const judgment = judgeVerification({ receipt, event, canonical, plan });
      if (receipt.verificationState === "verified") {
        if (verificationReplayAllowed({
          verifiedBy: receipt.verifiedBy,
          verifierPrincipal: plan.verifierPrincipal,
          judgment,
        })) {
          return { write: "replayed", receipt: { ...receipt } };
        }
        return {
          write: "rejected",
          code: PUBLICATION_ERROR.verificationMismatch,
          message: "publication is already verified; refusing to rewrite history",
        };
      }
      if (receipt.verificationState === "failed") {
        return {
          write: "mismatch",
          receipt: { ...receipt },
          state: "failed",
        };
      }
      if (receipt.verificationState !== "pending" && receipt.verificationState !== "uncertain") {
        return {
          write: "rejected",
          code: PUBLICATION_ERROR.verificationMismatch,
          message: "publication verification cannot be rewritten",
        };
      }
      const nextState = judgment === "match" ? "verified" : judgment;
      if (!verificationStateAllowed(receipt.verificationState, nextState)) {
        return {
          write: "rejected",
          code: PUBLICATION_ERROR.verificationMismatch,
          message: "publication verification cannot be rewritten",
        };
      }
      receipt.verificationState = nextState;
      receipt.verifiedBy = plan.verifierPrincipal;
      receipt.verifiedAt = plan.verifiedAt;
      this.afterWrite();
      if (nextState === "verified") return { write: "ok", receipt: { ...receipt } };
      return { write: "mismatch", receipt: { ...receipt }, state: nextState };
    }, { write: "uncertain" });
  }

  private snapshot(): Snapshot {
    return {
      proposals: new Map([...this.proposals].map(([id, row]) => [id, cloneProposal(row)])),
      revisions: this.revisions.map((row) => ({ ...row, body: { ...row.body } })),
      reviews: this.reviews.map((row) => ({ ...row })),
      attempts: this.attempts.map((row) => ({ ...row })),
      receipts: this.receipts.map((row) => ({ ...row, evidenceSnapshotIds: [...row.evidenceSnapshotIds] })),
      events: this.events.map((row) => ({ ...row, evidenceSnapshotIds: [...row.evidenceSnapshotIds] })),
      canonical: new Map([...this.canonical].map(([key, row]) => [key, { ...row }])),
    };
  }

  private restore(snapshot: Snapshot): void {
    this.proposals = snapshot.proposals;
    this.revisions = snapshot.revisions;
    this.reviews = snapshot.reviews;
    this.attempts = snapshot.attempts;
    this.receipts = snapshot.receipts;
    this.events = snapshot.events;
    this.canonical = snapshot.canonical;
  }

  private afterWrite(): void {
    if (this.failAfterWrites == null) return;
    this.failAfterWrites -= 1;
    if (this.failAfterWrites <= 0) {
      this.failAfterWrites = null;
      throw new Error("injected publication write fault");
    }
  }

  private atomically<T>(fn: () => T, uncertain: T): T {
    const snapshot = this.snapshot();
    try {
      return fn();
    } catch {
      this.restore(snapshot);
      return uncertain;
    }
  }
}

function attemptStateCommitted(state: PublicationAttempt["state"]): boolean {
  return state === "committed" || state === "reconciled_committed";
}
