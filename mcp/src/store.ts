import { randomUUID } from "node:crypto";
import type { ProposalRecord, ReviewRecord, RevisionRecord } from "./types.ts";

export type InsertResult = "inserted" | "conflict" | "uncertain";
export type CompoundWriteResult = "ok" | "uncertain";

export type ProposalRepository = {
  findByIdempotencyKey(key: string): Promise<ProposalRecord | null>;
  findById(id: string): Promise<ProposalRecord | null>;
  listRevisions(proposalId: string): Promise<RevisionRecord[]>;
  listReviews(proposalId: string): Promise<ReviewRecord[]>;
  createProposalWithInitialRevision(
    proposal: ProposalRecord,
    revision: RevisionRecord
  ): Promise<InsertResult>;
  recordReviewAndStatus(review: ReviewRecord, proposal: ProposalRecord): Promise<CompoundWriteResult>;
  reviseInvalidateAndUpdate(
    revision: RevisionRecord,
    proposal: ProposalRecord,
    invalidateAt: string
  ): Promise<CompoundWriteResult>;
};

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

  async recordReviewAndStatus(
    review: ReviewRecord,
    proposal: ProposalRecord
  ): Promise<CompoundWriteResult> {
    return this.atomically(() => {
      this.reviews.push({ ...review });
      this.afterWrite();
      this.proposals.set(proposal.id, { ...proposal, body: { ...proposal.body } });
      this.byKey.set(proposal.idempotencyKey, proposal.id);
      this.afterWrite();
      return "ok" as const;
    }, "uncertain");
  }

  async reviseInvalidateAndUpdate(
    revision: RevisionRecord,
    proposal: ProposalRecord,
    invalidateAt: string
  ): Promise<CompoundWriteResult> {
    return this.atomically(() => {
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
      return "ok" as const;
    }, "uncertain");
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
