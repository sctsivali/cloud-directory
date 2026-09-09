import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ERROR_CODE, OUTCOME } from "../src/errors.ts";
import { PostgresProposalRepository } from "../src/pg-store.ts";
import { submitProposal } from "../src/proposal-tools.ts";
import { approveProposal, reviewProposal, reviseProposal } from "../src/review-tools.ts";
import { MemoryProposalRepository, nowIso } from "../src/store.ts";
import type { ConnectionProvider, QueryExecutor } from "../src/pg-store.ts";
import { TEST_DATABASE_URL, withMigratedDatabase } from "./pg-harness.ts";
import { claimRevisionBody } from "./claim-body.ts";

const claim = {
  idempotencyKey: "tx-claim-1",
  subjectType: "provider",
  subjectId: "local-packages",
  claimType: "hypervisor",
  value: { text: "KVM" },
  knowledgeState: "present",
  assessmentState: "extracted",
};

class FaultInjectingProvider implements ConnectionProvider {
  writes = 0;
  private readonly inner: ConnectionProvider;
  private readonly failOnWrite: number;

  constructor(inner: ConnectionProvider | { query: ConnectionProvider["query"]; connect: ConnectionProvider["connect"] }, failOnWrite: number) {
    this.inner = inner as ConnectionProvider;
    this.failOnWrite = failOnWrite;
  }

  query: ConnectionProvider["query"] = (queryText, values) => this.inner.query(queryText, values);

  async connect() {
    const client = await this.inner.connect();
    return {
      query: ((queryText: string, values?: unknown[]) =>
        this.maybeFault(client, String(queryText), values)) as QueryExecutor["query"],
      release: () => client.release(),
    };
  }

  private async maybeFault(client: QueryExecutor, queryText: string, values?: unknown[]) {
    const trimmed = queryText.trim();
    if (/^(INSERT|UPDATE|DELETE)\b/i.test(trimmed)) {
      this.writes += 1;
      if (this.writes === this.failOnWrite) {
        throw Object.assign(new Error("injected write fault"), { code: "XX000" });
      }
    }
    return client.query(queryText, values);
  }
}

describe("in-memory compound transitions stay atomic", () => {
  it("does not keep a proposal without its initial revision after a mid-write fault", async () => {
    const repo = new MemoryProposalRepository();
    repo.failAfterWrites = 1;
    const result = await submitProposal(
      repo,
      "directory.propose_claim",
      { ...claim, idempotencyKey: "mem-partial-1" },
      "worker-a"
    );
    assert.equal(result.outcome, OUTCOME.ambiguous);
    if (result.outcome === "ambiguous") {
      assert.equal(result.code, ERROR_CODE.commitUncertain);
    }
    assert.equal(await repo.findByIdempotencyKey("mem-partial-1"), null);
    assert.equal(repo.revisions.length, 0);
    assert.equal(repo.proposals.size, 0);
  });

  it("does not keep a review when the status update cannot be confirmed", async () => {
    const repo = new MemoryProposalRepository();
    const created = await submitProposal(
      repo,
      "directory.propose_claim",
      { ...claim, idempotencyKey: "mem-review-1" },
      "worker-a"
    );
    assert.equal(created.outcome, OUTCOME.created);
    if (created.outcome !== "created") return;
    repo.failAfterWrites = 1;
    const reviewed = await reviewProposal(
      repo,
      { proposalId: created.proposal.id, decision: "reject" },
      "editor-1"
    );
    assert.equal(reviewed.outcome, OUTCOME.ambiguous);
    assert.equal((await repo.findById(created.proposal.id))?.status, "pending_review");
    assert.equal((await repo.listReviews(created.proposal.id)).length, 0);
  });

  it("does not leave a revision, invalidation, or status change after a mid-revise fault", async () => {
    const repo = new MemoryProposalRepository();
    const created = await submitProposal(
      repo,
      "directory.propose_claim",
      { ...claim, idempotencyKey: "mem-revise-1" },
      "worker-a"
    );
    assert.equal(created.outcome, OUTCOME.created);
    if (created.outcome !== "created") return;
    const approved = await approveProposal(repo, { proposalId: created.proposal.id }, "editor-1");
    assert.equal(approved.outcome, OUTCOME.created);
    const beforeReviews = await repo.listReviews(created.proposal.id);
    assert.equal(beforeReviews[0]?.invalidatedAt, null);
    repo.failAfterWrites = 1;
    const revised = await reviseProposal(
      repo,
      {
        proposalId: created.proposal.id,
        body: claimRevisionBody({ claimType: "storage" }),
      },
      "worker-a"
    );
    assert.equal(revised.outcome, OUTCOME.ambiguous);
    const after = await repo.findById(created.proposal.id);
    assert.equal(after?.status, "approved");
    assert.equal((await repo.listRevisions(created.proposal.id)).length, 1);
    assert.equal((await repo.listReviews(created.proposal.id))[0]?.invalidatedAt, null);
  });

  it("derives revision ordinal from current in-write state, not a stale pre-read", async () => {
    const repo = new MemoryProposalRepository();
    const created = await submitProposal(
      repo,
      "directory.propose_claim",
      { ...claim, idempotencyKey: "mem-ordinal-1" },
      "worker-a"
    );
    assert.equal(created.outcome, OUTCOME.created);
    if (created.outcome !== "created") return;
    repo.revisions.push({
      id: "sneaked-revision",
      proposalId: created.proposal.id,
      revisionOrdinal: 2,
      body: { sneaked: true },
      bodyDigest: "b".repeat(64),
      actorId: "worker-a",
      createdAt: nowIso(),
    });
    const revised = await reviseProposal(
      repo,
      {
        proposalId: created.proposal.id,
        body: claimRevisionBody({ claimType: "storage" }),
      },
      "worker-a"
    );
    assert.equal(revised.outcome, OUTCOME.created);
    const ordinals = (await repo.listRevisions(created.proposal.id)).map((row) => row.revisionOrdinal);
    assert.deepEqual(ordinals, [1, 2, 3]);
  });
});

describe("PostgreSQL repository acquires a dedicated transaction client", () => {
  it("connects once per compound write and releases in finally after success or fault", async () => {
    let acquired = 0;
    let released = 0;
    let beginOn: object | null = null;
    let insertOn: object | null = null;
    const provider = {
      query: async () => ({ rows: [] }),
      async connect() {
        acquired += 1;
        const client = {
          query: async (queryText: string) => {
            const text = String(queryText);
            if (text.trim() === "BEGIN") beginOn = client;
            if (/^INSERT\b/i.test(text.trim())) insertOn = client;
            if (acquired > 1 && text.trim() === "BEGIN") {
              throw new Error("second transaction used a shared session");
            }
            return { rows: [] };
          },
          release() {
            released += 1;
          },
        };
        return client;
      },
    };
    const repo = new PostgresProposalRepository(provider as ConnectionProvider);
    const now = new Date().toISOString();
    const proposal = {
      id: "p-dedicated-1",
      toolName: "directory.propose_claim",
      actorId: "worker-a",
      idempotencyKey: "dedicated-1",
      body: { claimType: "hypervisor" },
      bodyDigest: "a".repeat(64),
      status: "pending_review" as const,
      createdAt: now,
      updatedAt: now,
    };
    const revision = {
      id: "r-dedicated-1",
      proposalId: proposal.id,
      revisionOrdinal: 1,
      body: proposal.body,
      bodyDigest: proposal.bodyDigest,
      actorId: "worker-a",
      createdAt: now,
    };
    const first = await repo.createProposalWithInitialRevision(proposal, revision);
    assert.equal(first, "inserted");
    assert.equal(acquired, 1);
    assert.equal(released, 1);
    assert.equal(beginOn, insertOn);

    const faulting = {
      query: async () => ({ rows: [] }),
      async connect() {
        acquired += 1;
        return {
          query: async (queryText: string) => {
            if (/^INSERT\b/i.test(String(queryText).trim())) {
              throw Object.assign(new Error("injected"), { code: "XX000" });
            }
            return { rows: [] };
          },
          release() {
            released += 1;
          },
        };
      },
    };
    const uncertain = await new PostgresProposalRepository(faulting as ConnectionProvider).createProposalWithInitialRevision(
      { ...proposal, id: "p-dedicated-2", idempotencyKey: "dedicated-2" },
      { ...revision, id: "r-dedicated-2", proposalId: "p-dedicated-2" }
    );
    assert.equal(uncertain, "uncertain");
    assert.equal(acquired, 2);
    assert.equal(released, 2);
  });

  it("locks the proposal row before any review or revision mutation on that client", async () => {
    const queries: string[] = [];
    const now = new Date().toISOString();
    const proposalRow = {
      id: "p-lock-1",
      tool_name: "directory.propose_claim",
      actor_id: "worker-a",
      idempotency_key: "lock-1",
      body: { claimType: "hypervisor" },
      body_digest: "a".repeat(64),
      status: "pending_review",
      created_at: now,
      updated_at: now,
    };
    const provider = {
      query: async () => ({ rows: [] }),
      async connect() {
        return {
          query: async (queryText: string) => {
            queries.push(String(queryText));
            const text = String(queryText);
            if (/FROM revisions/i.test(text) && /FOR UPDATE/i.test(text)) {
              return {
                rows: [
                  {
                    id: "r-lock-1",
                    proposal_id: proposalRow.id,
                    revision_ordinal: 1,
                    body: proposalRow.body,
                    body_digest: proposalRow.body_digest,
                    actor_id: "worker-a",
                    created_at: now,
                  },
                ],
              };
            }
            if (/FOR UPDATE/i.test(text)) return { rows: [proposalRow] };
            if (/MAX\(revision_ordinal\)/i.test(text)) return { rows: [{ n: 1 }] };
            return { rows: [] };
          },
          release() {},
        };
      },
    };
    const repo = new PostgresProposalRepository(provider as ConnectionProvider);
    const reviewed = await repo.recordReviewAndStatus({
      id: "revw-lock-1",
      proposalId: proposalRow.id,
      reviewerId: "editor-1",
      decision: "reject",
      comment: null,
      createdAt: now,
      invalidatedAt: null,
    });
    assert.equal(reviewed.write, "ok");
    assertLockThenWrite(queries);
    queries.length = 0;
    const revised = await repo.reviseInvalidateAndUpdate(
      {
        id: "rev-lock-1",
        proposalId: proposalRow.id,
        body: claimRevisionBody({ claimType: "storage" }),
        actorId: "worker-a",
        createdAt: now,
      },
      now
    );
    assert.equal(revised.write, "ok");
    assertLockThenWrite(queries);
  });
});

function assertLockThenWrite(queries: string[]): void {
  const begin = queries.findIndex((query) => query.trim() === "BEGIN");
  const lock = queries.findIndex((query) => /FOR UPDATE/i.test(query));
  const write = queries.findIndex((query) => /^(INSERT|UPDATE|DELETE)\b/i.test(query.trim()));
  assert.ok(begin >= 0, "missing BEGIN");
  assert.ok(lock > begin, "FOR UPDATE must run after BEGIN");
  assert.ok(write > lock, "mutation must run after FOR UPDATE");
}

describe("PostgreSQL compound transitions stay atomic", { skip: !TEST_DATABASE_URL }, () => {
  it("rolls back proposal+revision so a fault leaves no partial row", async () => {
    await withMigratedDatabase(async (client, pool) => {
      const faulting = new FaultInjectingProvider(pool, 2);
      const repo = new PostgresProposalRepository(faulting);
      const result = await submitProposal(
        repo,
        "directory.propose_claim",
        { ...claim, idempotencyKey: "pg-partial-1" },
        "worker-a"
      );
      assert.equal(result.outcome, OUTCOME.ambiguous);
      if (result.outcome === "ambiguous") {
        assert.equal(result.code, "commit_uncertain");
      }
      const proposals = await client.query("SELECT count(*)::int AS n FROM proposals");
      const revisions = await client.query("SELECT count(*)::int AS n FROM revisions");
      assert.equal(proposals.rows[0].n, 0);
      assert.equal(revisions.rows[0].n, 0);
    });
  });

  it("rolls back review+status so a fault leaves neither a review nor a status change", async () => {
    await withMigratedDatabase(async (client, pool) => {
      const live = new PostgresProposalRepository(pool);
      const created = await submitProposal(
        live,
        "directory.propose_claim",
        { ...claim, idempotencyKey: "pg-review-1" },
        "worker-a"
      );
      assert.equal(created.outcome, OUTCOME.created);
      if (created.outcome !== "created") return;
      const faulting = new FaultInjectingProvider(pool, 2);
      const repo = new PostgresProposalRepository(faulting);
      const reviewed = await reviewProposal(
        repo,
        { proposalId: created.proposal.id, decision: "request_changes" },
        "editor-1"
      );
      assert.equal(reviewed.outcome, OUTCOME.ambiguous);
      const status = await client.query("SELECT status FROM proposals WHERE id = $1", [
        created.proposal.id,
      ]);
      const reviews = await client.query("SELECT count(*)::int AS n FROM proposal_reviews");
      assert.equal(status.rows[0].status, "pending_review");
      assert.equal(reviews.rows[0].n, 0);
    });
  });

  it("rolls back revision+invalidation+status so an approved proposal is unchanged after a fault", async () => {
    await withMigratedDatabase(async (client, pool) => {
      const live = new PostgresProposalRepository(pool);
      const created = await submitProposal(
        live,
        "directory.propose_claim",
        { ...claim, idempotencyKey: "pg-revise-1" },
        "worker-a"
      );
      assert.equal(created.outcome, OUTCOME.created);
      if (created.outcome !== "created") return;
      const approved = await approveProposal(live, { proposalId: created.proposal.id }, "editor-1");
      assert.equal(approved.outcome, OUTCOME.created);
      const faulting = new FaultInjectingProvider(pool, 2);
      const repo = new PostgresProposalRepository(faulting);
      const revised = await reviseProposal(
        repo,
        {
          proposalId: created.proposal.id,
          body: claimRevisionBody({ claimType: "storage" }),
        },
        "worker-a"
      );
      assert.equal(revised.outcome, OUTCOME.ambiguous);
      const proposal = await client.query("SELECT status, body_digest FROM proposals WHERE id = $1", [
        created.proposal.id,
      ]);
      const revisions = await client.query("SELECT count(*)::int AS n FROM revisions");
      const approvals = await client.query(
        "SELECT invalidated_at FROM proposal_reviews WHERE decision = 'approve'"
      );
      assert.equal(proposal.rows[0].status, "approved");
      assert.equal(revisions.rows[0].n, 1);
      assert.equal(approvals.rows[0].invalidated_at, null);
    });
  });

  it("does not blindly retry after an ambiguous create", async () => {
    await withMigratedDatabase(async (client, pool) => {
      const faulting = new FaultInjectingProvider(pool, 1);
      const repo = new PostgresProposalRepository(faulting);
      const first = await submitProposal(
        repo,
        "directory.propose_claim",
        { ...claim, idempotencyKey: "pg-ambiguous-1" },
        "worker-a"
      );
      assert.equal(first.outcome, OUTCOME.ambiguous);
      const countAfterAmbiguous = await client.query("SELECT count(*)::int AS n FROM proposals");
      assert.equal(countAfterAmbiguous.rows[0].n, 0);
      const live = new PostgresProposalRepository(pool);
      const lookup = await live.findByIdempotencyKey("pg-ambiguous-1");
      assert.equal(lookup, null);
    });
  });
});
