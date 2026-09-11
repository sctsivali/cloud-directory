import { randomUUID } from "node:crypto";
import { bodyDigest } from "./digest.ts";
import type { ProposalRecord, ProposalStatus, ReviewRecord, RevisionRecord } from "./types.ts";

export type InsertResult = "inserted" | "conflict" | "uncertain";
export type CompoundWriteResult = "ok" | "uncertain";

export type RevisionIntent = {
  id: string;
  proposalId: string;
  body: Record<string, unknown>;
  actorId: string;
  createdAt: string;
};

export type ReviewWriteResult =
  | { write: "ok"; proposal: ProposalRecord; review: ReviewRecord }
  | { write: "uncertain" }
  | { write: "not_found" }
  | { write: "self_approval" }
  | { write: "illegal_transition" };

export type RevisionWriteResult =
  | { write: "ok"; proposal: ProposalRecord; revision: RevisionRecord }
  | { write: "uncertain" }
  | { write: "not_found" }
  | { write: "illegal_transition" };

export const PROPOSAL_STATUS_TRANSITIONS: Record<ProposalStatus, readonly ProposalStatus[]> = {
  pending_review: ["pending_review", "approved", "rejected", "changes_requested"],
  changes_requested: ["pending_review", "approved", "rejected", "changes_requested"],
  approved: ["pending_review", "published"],
  rejected: ["pending_review"],
  published: ["pending_review"],
};

export function proposalStatusTransitionAllowed(from: string, to: string): boolean {
  const allowed = PROPOSAL_STATUS_TRANSITIONS[from as ProposalStatus];
  return Boolean(allowed?.includes(to as ProposalStatus));
}

export function latestRevisionOf(revisions: RevisionRecord[]): RevisionRecord | null {
  if (!revisions.length) return null;
  return revisions.reduce((latest, row) => (row.revisionOrdinal >= latest.revisionOrdinal ? row : latest));
}

export function dutiesConflict(
  principalId: string,
  proposalActorId: string,
  revisionActorId?: string | null
): boolean {
  return principalId === proposalActorId || (Boolean(revisionActorId) && principalId === revisionActorId);
}

export type ProposalRepository = {
  findByIdempotencyKey(key: string): Promise<ProposalRecord | null>;
  findById(id: string): Promise<ProposalRecord | null>;
  listRevisions(proposalId: string): Promise<RevisionRecord[]>;
  listReviews(proposalId: string): Promise<ReviewRecord[]>;
  createProposalWithInitialRevision(
    proposal: ProposalRecord,
    revision: RevisionRecord
  ): Promise<InsertResult>;
  recordReviewAndStatus(review: ReviewRecord): Promise<ReviewWriteResult>;
  reviseInvalidateAndUpdate(
    revision: RevisionIntent,
    invalidateAt: string
  ): Promise<RevisionWriteResult>;
};

export function statusForReviewDecision(decision: ReviewRecord["decision"]): ProposalRecord["status"] {
  if (decision === "approve") return "approved";
  if (decision === "reject") return "rejected";
  return "changes_requested";
}

export function derivedReviewProposal(current: ProposalRecord, review: ReviewRecord): ProposalRecord {
  return {
    ...current,
    status: statusForReviewDecision(review.decision),
    updatedAt: review.createdAt,
  };
}

export function derivedRevision(
  current: ProposalRecord,
  maxOrdinal: number,
  intent: RevisionIntent
): { proposal: ProposalRecord; revision: RevisionRecord } {
  const { toolName: _toolName, idempotencyKey: _key, ...fields } = intent.body;
  void _toolName;
  void _key;
  const nextBody = { toolName: current.toolName, ...fields };
  const digest = bodyDigest(nextBody);
  return {
    proposal: {
      ...current,
      body: nextBody,
      bodyDigest: digest,
      status: "pending_review",
      updatedAt: intent.createdAt,
    },
    revision: {
      id: intent.id,
      proposalId: current.id,
      revisionOrdinal: maxOrdinal + 1,
      body: { ...fields },
      bodyDigest: digest,
      actorId: intent.actorId,
      createdAt: intent.createdAt,
    },
  };
}

export function newProposalId(): string {
  return randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

type MemorySnapshot = {
  proposals: Map<string, ProposalRecord>;
  byKey: Map<string, string>;
  revisions: RevisionRecord[];
  reviews: ReviewRecord[];
};

export class MemoryProposalRepository implements ProposalRepository {
  proposals = new Map<string, ProposalRecord>();
  byKey = new Map<string, string>();
  revisions: RevisionRecord[] = [];
  reviews: ReviewRecord[] = [];
  failNextInsert: "conflict" | "uncertain" | null = null;
  failAfterWrites: number | null = null;

  async findByIdempotencyKey(key: string): Promise<ProposalRecord | null> {
    const id = this.byKey.get(key);
    return id ? this.cloneProposal(this.proposals.get(id) ?? null) : null;
  }

  async findById(id: string): Promise<ProposalRecord | null> {
    return this.cloneProposal(this.proposals.get(id) ?? null);
  }

  async listRevisions(proposalId: string): Promise<RevisionRecord[]> {
    return this.revisions.filter((row) => row.proposalId === proposalId).map((row) => ({ ...row }));
  }

  async listReviews(proposalId: string): Promise<ReviewRecord[]> {
    return this.reviews.filter((row) => row.proposalId === proposalId).map((row) => ({ ...row }));
  }

  async createProposalWithInitialRevision(
    proposal: ProposalRecord,
    revision: RevisionRecord
  ): Promise<InsertResult> {
    if (this.failNextInsert === "uncertain") {
      this.failNextInsert = null;
      return "uncertain";
    }
    if (this.failNextInsert === "conflict" || this.byKey.has(proposal.idempotencyKey)) {
      this.failNextInsert = null;
      return "conflict";
    }
    return this.atomically(() => {
      this.proposals.set(proposal.id, { ...proposal, body: { ...proposal.body } });
      this.byKey.set(proposal.idempotencyKey, proposal.id);
      this.afterWrite();
      this.revisions.push({ ...revision, body: { ...revision.body } });
      this.afterWrite();
      return "inserted" as const;
    }, "uncertain");
  }

  async recordReviewAndStatus(review: ReviewRecord): Promise<ReviewWriteResult> {
    return this.atomically<ReviewWriteResult>(() => {
      const current = this.proposals.get(review.proposalId);
      if (!current) return { write: "not_found" as const };
      const latest = latestRevisionOf(this.revisions.filter((row) => row.proposalId === review.proposalId));
      if (review.decision === "approve" && dutiesConflict(review.reviewerId, current.actorId, latest?.actorId)) {
        return { write: "self_approval" as const };
      }
      const nextStatus = statusForReviewDecision(review.decision);
      if (!proposalStatusTransitionAllowed(current.status, nextStatus)) {
        return { write: "illegal_transition" as const };
      }
      if (review.decision === "approve" && (!latest || latest.bodyDigest !== current.bodyDigest)) {
        return { write: "illegal_transition" as const };
      }
      const bound: ReviewRecord = {
        ...review,
        boundRevisionId: latest?.id ?? null,
        boundBodyDigest: latest?.bodyDigest ?? current.bodyDigest,
      };
      const proposal = derivedReviewProposal(current, bound);
      this.reviews.push({ ...bound });
      this.afterWrite();
      this.proposals.set(proposal.id, { ...proposal, body: { ...proposal.body } });
      this.byKey.set(proposal.idempotencyKey, proposal.id);
      this.afterWrite();
      return { write: "ok" as const, proposal: this.cloneProposal(proposal)!, review: { ...bound } };
    }, { write: "uncertain" as const });
  }

  async reviseInvalidateAndUpdate(
    intent: RevisionIntent,
    invalidateAt: string
  ): Promise<RevisionWriteResult> {
    return this.atomically<RevisionWriteResult>(() => {
      const current = this.proposals.get(intent.proposalId);
      if (!current) return { write: "not_found" as const };
      if (!proposalStatusTransitionAllowed(current.status, "pending_review")) {
        return { write: "illegal_transition" as const };
      }
      const maxOrdinal = this.revisions
        .filter((row) => row.proposalId === intent.proposalId)
        .reduce((max, row) => Math.max(max, row.revisionOrdinal), 0);
      const { proposal, revision } = derivedRevision(current, maxOrdinal, intent);
      this.revisions.push({ ...revision, body: { ...revision.body } });
      this.afterWrite();
      for (const row of this.reviews) {
        if (row.proposalId === proposal.id && row.decision === "approve" && row.invalidatedAt == null) {
          row.invalidatedAt = invalidateAt;
        }
      }
      this.afterWrite();
      this.proposals.set(proposal.id, { ...proposal, body: { ...proposal.body } });
      this.byKey.set(proposal.idempotencyKey, proposal.id);
      this.afterWrite();
      return {
        write: "ok" as const,
        proposal: this.cloneProposal(proposal)!,
        revision: { ...revision, body: { ...revision.body } },
      };
    }, { write: "uncertain" as const });
  }

  private snapshot(): MemorySnapshot {
    return {
      proposals: new Map(
        [...this.proposals].map(([id, row]) => [id, { ...row, body: { ...row.body } }])
      ),
      byKey: new Map(this.byKey),
      revisions: this.revisions.map((row) => ({ ...row, body: { ...row.body } })),
      reviews: this.reviews.map((row) => ({ ...row })),
    };
  }

  private restore(snapshot: MemorySnapshot): void {
    this.proposals = snapshot.proposals;
    this.byKey = snapshot.byKey;
    this.revisions = snapshot.revisions;
    this.reviews = snapshot.reviews;
  }

  private afterWrite(): void {
    if (this.failAfterWrites == null) return;
    this.failAfterWrites -= 1;
    if (this.failAfterWrites <= 0) {
      this.failAfterWrites = null;
      throw new Error("injected write fault");
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

  private cloneProposal(row: ProposalRecord | null): ProposalRecord | null {
    return row ? { ...row, body: { ...row.body } } : null;
  }
}
