import { Pool } from "./pg.ts";
import type { CompoundWriteResult, InsertResult, ProposalRepository } from "./store.ts";
import type { ProposalRecord, ReviewRecord, RevisionRecord } from "./types.ts";

export type QueryRows<T = Record<string, unknown>> = { rows: T[] };

export type QueryExecutor = {
  query<T = Record<string, unknown>>(queryText: string, values?: unknown[]): Promise<QueryRows<T>>;
};

export type DedicatedClient = QueryExecutor & {
  release(): void;
};

export type ConnectionProvider = QueryExecutor & {
  connect(): Promise<DedicatedClient>;
};

type ProposalRow = {
  id: string;
  tool_name: string;
  actor_id: string;
  idempotency_key: string;
  body: Record<string, unknown>;
  body_digest: string;
  status: ProposalRecord["status"];
  created_at: Date | string;
  updated_at: Date | string;
};

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapProposal(row: ProposalRow): ProposalRecord {
  return {
    id: row.id,
    toolName: row.tool_name,
    actorId: row.actor_id,
    idempotencyKey: row.idempotency_key,
    body: row.body,
    bodyDigest: row.body_digest,
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function pgCode(err: unknown): string | undefined {
  return (err as { code?: string }).code;
}

function asConnectionProvider(provider: ConnectionProvider | InstanceType<typeof Pool>): ConnectionProvider {
  if (typeof provider.connect !== "function" || typeof provider.query !== "function") {
    throw new Error("PostgresProposalRepository requires a Pool or connection provider");
  }
  return provider as ConnectionProvider;
}

export class PostgresProposalRepository implements ProposalRepository {
  private readonly provider: ConnectionProvider;

  constructor(provider: ConnectionProvider | InstanceType<typeof Pool>) {
    this.provider = asConnectionProvider(provider as ConnectionProvider);
  }

  async findByIdempotencyKey(key: string): Promise<ProposalRecord | null> {
    const { rows } = await this.provider.query<ProposalRow>(
      "SELECT * FROM proposals WHERE idempotency_key = $1",
      [key]
    );
    return rows[0] ? mapProposal(rows[0]) : null;
  }

  async findById(id: string): Promise<ProposalRecord | null> {
    const { rows } = await this.provider.query<ProposalRow>("SELECT * FROM proposals WHERE id = $1", [
      id,
    ]);
    return rows[0] ? mapProposal(rows[0]) : null;
  }

  async listRevisions(proposalId: string): Promise<RevisionRecord[]> {
    const { rows } = await this.provider.query<{
      id: string;
      proposal_id: string;
      revision_ordinal: number;
      body: Record<string, unknown>;
      body_digest: string;
      actor_id: string;
      created_at: Date | string;
    }>("SELECT * FROM revisions WHERE proposal_id = $1 ORDER BY revision_ordinal", [proposalId]);
    return rows.map((row) => ({
      id: row.id,
      proposalId: row.proposal_id,
      revisionOrdinal: row.revision_ordinal,
      body: row.body,
      bodyDigest: row.body_digest,
      actorId: row.actor_id,
      createdAt: iso(row.created_at),
    }));
  }

  async listReviews(proposalId: string): Promise<ReviewRecord[]> {
    const { rows } = await this.provider.query<{
      id: string;
      proposal_id: string;
      reviewer_id: string;
      decision: ReviewRecord["decision"];
      comment: string | null;
      created_at: Date | string;
      invalidated_at: Date | string | null;
    }>("SELECT * FROM proposal_reviews WHERE proposal_id = $1 ORDER BY created_at", [proposalId]);
    return rows.map((row) => ({
      id: row.id,
      proposalId: row.proposal_id,
      reviewerId: row.reviewer_id,
      decision: row.decision,
      comment: row.comment,
      createdAt: iso(row.created_at),
      invalidatedAt: row.invalidated_at ? iso(row.invalidated_at) : null,
    }));
  }

  async createProposalWithInitialRevision(
    proposal: ProposalRecord,
    revision: RevisionRecord
  ): Promise<InsertResult> {
    const result = await this.transact(async (client) => {
      await client.query(
        `INSERT INTO proposals (
           id, tool_name, actor_id, idempotency_key, body, body_digest, status, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)`,
        [
          proposal.id,
          proposal.toolName,
          proposal.actorId,
          proposal.idempotencyKey,
          JSON.stringify(proposal.body),
          proposal.bodyDigest,
          proposal.status,
          proposal.createdAt,
          proposal.updatedAt,
        ]
      );
      await client.query(
        `INSERT INTO revisions (
           id, proposal_id, revision_ordinal, body, body_digest, actor_id, created_at
         ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)`,
        [
          revision.id,
          revision.proposalId,
          revision.revisionOrdinal,
          JSON.stringify(revision.body),
          revision.bodyDigest,
          revision.actorId,
          revision.createdAt,
        ]
      );
    });
    if (result === "ok") return "inserted";
    if (result === "conflict") return "conflict";
    return "uncertain";
  }

  async recordReviewAndStatus(
    review: ReviewRecord,
    proposal: ProposalRecord
  ): Promise<CompoundWriteResult> {
    const result = await this.transact(async (client) => {
      await this.insertReviewRow(client, review);
      await this.updateProposalRow(client, proposal);
    });
    return result === "ok" ? "ok" : "uncertain";
  }

  async reviseInvalidateAndUpdate(
    revision: RevisionRecord,
    proposal: ProposalRecord,
    invalidateAt: string
  ): Promise<CompoundWriteResult> {
    const result = await this.transact(async (client) => {
      await client.query(
        `INSERT INTO revisions (
           id, proposal_id, revision_ordinal, body, body_digest, actor_id, created_at
         ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)`,
        [
          revision.id,
          revision.proposalId,
          revision.revisionOrdinal,
          JSON.stringify(revision.body),
          revision.bodyDigest,
          revision.actorId,
          revision.createdAt,
        ]
      );
      await client.query(
        `UPDATE proposal_reviews
         SET invalidated_at = $2
         WHERE proposal_id = $1 AND decision = 'approve' AND invalidated_at IS NULL`,
        [proposal.id, invalidateAt]
      );
      await this.updateProposalRow(client, proposal);
    });
    return result === "ok" ? "ok" : "uncertain";
  }

  private async insertReviewRow(client: QueryExecutor, row: ReviewRecord): Promise<void> {
    await client.query(
      `INSERT INTO proposal_reviews (
         id, proposal_id, reviewer_id, decision, comment, created_at, invalidated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        row.id,
        row.proposalId,
        row.reviewerId,
        row.decision,
        row.comment,
        row.createdAt,
        row.invalidatedAt,
      ]
    );
  }

  private async updateProposalRow(client: QueryExecutor, row: ProposalRecord): Promise<void> {
    await client.query(
      `UPDATE proposals
       SET tool_name = $2, actor_id = $3, idempotency_key = $4, body = $5::jsonb,
           body_digest = $6, status = $7, updated_at = $8
       WHERE id = $1`,
      [
        row.id,
        row.toolName,
        row.actorId,
        row.idempotencyKey,
        JSON.stringify(row.body),
        row.bodyDigest,
        row.status,
        row.updatedAt,
      ]
    );
  }

  private async transact(fn: (client: QueryExecutor) => Promise<void>): Promise<"ok" | "conflict" | "uncertain"> {
    let client: DedicatedClient | undefined;
    try {
      client = await this.provider.connect();
    } catch {
      return "uncertain";
    }
    try {
      try {
        await client.query("BEGIN");
      } catch {
        return "uncertain";
      }
      try {
        await fn(client);
        await client.query("COMMIT");
        return "ok";
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch {
          return "uncertain";
        }
        if (pgCode(err) === "23505") return "conflict";
        return "uncertain";
      }
    } finally {
      try {
        client.release();
      } catch {
        // already released or disconnected
      }
    }
  }
}
