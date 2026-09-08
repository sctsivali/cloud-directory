import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OUTCOME } from "../src/errors.ts";
import { PostgresProposalRepository, type ConnectionProvider } from "../src/pg-store.ts";
import { submitProposal } from "../src/proposal-tools.ts";
import { reviewProposal, reviseProposal } from "../src/review-tools.ts";
import { createDirectoryMcpServer } from "../src/server.ts";
import { TEST_DATABASE_URL, withMigratedDatabase } from "./pg-harness.ts";

const claim = {
  subjectType: "provider",
  subjectId: "local-packages",
  claimType: "hypervisor",
  value: { text: "KVM" },
  knowledgeState: "present",
  assessmentState: "extracted",
};

function payloadOf(result: unknown): Record<string, unknown> {
  const record = result as { content?: { text?: string }[] };
  const text = record.content?.[0]?.text;
  if (typeof text !== "string") throw new Error("missing tool text");
  return JSON.parse(text) as Record<string, unknown>;
}

describe("PostgreSQL concurrent MCP requests stay isolated", { skip: !TEST_DATABASE_URL }, () => {
  it("converges same-key races to one proposal and one initial revision", async () => {
    await withMigratedDatabase(async (client, pool) => {
      const repo = new PostgresProposalRepository(pool);
      const proposer = createDirectoryMcpServer({
        capabilities: ["propose"],
        context: { reader: null, repo, principalId: "worker-a" },
      });
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          proposer.invoke("directory.propose_claim", {
            ...claim,
            idempotencyKey: "race-same-key",
          })
        )
      );
      const payloads = results.map(payloadOf);
      for (const payload of payloads) {
        assert.ok(
          payload.outcome === OUTCOME.created || payload.outcome === OUTCOME.replayed,
          String(payload.outcome)
        );
      }
      const created = payloads.filter((row) => row.outcome === OUTCOME.created);
      assert.ok(created.length <= 1);
      const proposals = await client.query("SELECT id, idempotency_key FROM proposals");
      const revisions = await client.query(
        "SELECT id, proposal_id, revision_ordinal FROM revisions ORDER BY revision_ordinal"
      );
      assert.equal(proposals.rows.length, 1);
      assert.equal(revisions.rows.length, 1);
      assert.equal(revisions.rows[0].proposal_id, proposals.rows[0].id);
      assert.equal(revisions.rows[0].revision_ordinal, 1);
      const ids = new Set(
        payloads.map((row) => (row.proposal as { id?: string } | undefined)?.id).filter(Boolean)
      );
      assert.equal(ids.size, 1);
    });
  });

  it("does not let a rolled-back request erase a concurrent sibling write", async () => {
    await withMigratedDatabase(async (client, pool) => {
      let writes = 0;
      const faulting = {
        query: pool.query.bind(pool),
        async connect() {
          const leased = await pool.connect();
          return {
            query: async (queryText: string, values?: unknown[]) => {
              const trimmed = String(queryText).trim();
              if (/^INSERT INTO proposals\b/i.test(trimmed)) {
                writes += 1;
                if (writes === 2) {
                  throw Object.assign(new Error("injected sibling fault"), { code: "XX000" });
                }
              }
              return leased.query(queryText, values);
            },
            release: () => leased.release(),
          };
        },
      };
      const repo = new PostgresProposalRepository(faulting as ConnectionProvider);
      const left = createDirectoryMcpServer({
        capabilities: ["propose"],
        context: { reader: null, repo, principalId: "worker-a" },
      });
      const right = createDirectoryMcpServer({
        capabilities: ["propose"],
        context: { reader: null, repo, principalId: "worker-b" },
      });
      const [a, b] = await Promise.all([
        left.invoke("directory.propose_claim", {
          ...claim,
          idempotencyKey: "xtalk-a",
          value: { text: "KVM-A" },
        }),
        right.invoke("directory.propose_claim", {
          ...claim,
          idempotencyKey: "xtalk-b",
          subjectId: "global-asean",
          value: { text: "KVM-B" },
        }),
      ]);
      const payloads = [payloadOf(a), payloadOf(b)];
      const outcomes = payloads.map((row) => row.outcome).sort();
      assert.deepEqual(outcomes, [OUTCOME.ambiguous, OUTCOME.created]);
      const proposals = await client.query(
        "SELECT id, idempotency_key, actor_id, body FROM proposals ORDER BY idempotency_key"
      );
      const revisions = await client.query(
        "SELECT proposal_id, body, actor_id FROM revisions"
      );
      assert.equal(proposals.rows.length, 1);
      assert.equal(revisions.rows.length, 1);
      const kept = proposals.rows[0];
      assert.ok(kept.idempotency_key === "xtalk-a" || kept.idempotency_key === "xtalk-b");
      assert.equal(revisions.rows[0].proposal_id, kept.id);
      assert.equal(revisions.rows[0].actor_id, kept.actor_id);
      const body = kept.body as { value?: { text?: string } };
      const revBody = revisions.rows[0].body as { value?: { text?: string } };
      assert.equal(body.value?.text, revBody.value?.text);
      if (kept.idempotency_key === "xtalk-a") {
        assert.equal(kept.actor_id, "worker-a");
        assert.equal(body.value?.text, "KVM-A");
      } else {
        assert.equal(kept.actor_id, "worker-b");
        assert.equal(body.value?.text, "KVM-B");
      }
    });
  });

  it("keeps concurrent review and revision transitions isolated across proposals", async () => {
    await withMigratedDatabase(async (client, pool) => {
      const repo = new PostgresProposalRepository(pool);
      const worker = createDirectoryMcpServer({
        capabilities: ["propose"],
        context: { reader: null, repo, principalId: "worker-a" },
      });
      const first = payloadOf(
        await worker.invoke("directory.propose_claim", {
          ...claim,
          idempotencyKey: "iso-a",
          value: { text: "KVM-A" },
        })
      );
      const second = payloadOf(
        await worker.invoke("directory.propose_claim", {
          ...claim,
          idempotencyKey: "iso-b",
          subjectId: "global-asean",
          value: { text: "KVM-B" },
        })
      );
      assert.equal(first.outcome, OUTCOME.created);
      assert.equal(second.outcome, OUTCOME.created);
      const idA = (first.proposal as { id: string }).id;
      const idB = (second.proposal as { id: string }).id;

      const editor = createDirectoryMcpServer({
        capabilities: ["review", "approve"],
        context: { reader: null, repo, principalId: "editor-1" },
      });
      const reviser = createDirectoryMcpServer({
        capabilities: ["propose"],
        context: { reader: null, repo, principalId: "worker-a" },
      });
      const [approved, rejected, revised] = await Promise.all([
        editor.invoke("directory.approve_proposal", { proposalId: idA }),
        editor.invoke("directory.review_proposal", { proposalId: idB, decision: "reject" }),
        reviser.invoke("directory.revise_proposal", {
          proposalId: idA,
          body: { subjectId: "local-packages", claimType: "storage" },
        }),
      ]);
      const approvePayload = payloadOf(approved);
      const rejectPayload = payloadOf(rejected);
      const revisePayload = payloadOf(revised);
      assert.ok(
        approvePayload.outcome === OUTCOME.created || approvePayload.outcome === OUTCOME.ambiguous,
        String(approvePayload.outcome)
      );
      assert.equal(rejectPayload.outcome, OUTCOME.created);
      assert.ok(
        revisePayload.outcome === OUTCOME.created || revisePayload.outcome === OUTCOME.ambiguous,
        String(revisePayload.outcome)
      );

      const proposalA = await client.query("SELECT status FROM proposals WHERE id = $1", [idA]);
      const proposalB = await client.query("SELECT status FROM proposals WHERE id = $1", [idB]);
      const reviewsA = await client.query(
        "SELECT decision, reviewer_id, invalidated_at FROM proposal_reviews WHERE proposal_id = $1",
        [idA]
      );
      const reviewsB = await client.query(
        "SELECT decision, reviewer_id FROM proposal_reviews WHERE proposal_id = $1",
        [idB]
      );
      const revisionsA = await client.query(
        "SELECT revision_ordinal FROM revisions WHERE proposal_id = $1 ORDER BY revision_ordinal",
        [idA]
      );
      const revisionsB = await client.query(
        "SELECT revision_ordinal FROM revisions WHERE proposal_id = $1",
        [idB]
      );

      assert.equal(proposalB.rows[0].status, "rejected");
      assert.equal(reviewsB.rows.length, 1);
      assert.equal(reviewsB.rows[0].decision, "reject");
      assert.equal(reviewsB.rows[0].reviewer_id, "editor-1");
      assert.equal(revisionsB.rows.length, 1);

      assert.ok(["approved", "pending_review"].includes(proposalA.rows[0].status));
      assert.equal(
        reviewsA.rows.some((row) => row.decision === "reject"),
        false
      );
      assert.equal(
        reviewsB.rows.some((row) => row.decision === "approve"),
        false
      );
      if (proposalA.rows[0].status === "approved") {
        assert.equal(revisionsA.rows.length, 1);
        assert.equal(reviewsA.rows.length, 1);
        assert.equal(reviewsA.rows[0].decision, "approve");
        assert.equal(reviewsA.rows[0].invalidated_at, null);
      } else {
        assert.ok(revisionsA.rows.length >= 1);
        const liveApprovals = reviewsA.rows.filter(
          (row) => row.decision === "approve" && row.invalidated_at == null
        );
        assert.equal(liveApprovals.length, 0);
      }

      const direct = await Promise.all([
        repo.findById(idA),
        repo.findById(idB),
        repo.listReviews(idA),
        repo.listReviews(idB),
        repo.listRevisions(idA),
        repo.listRevisions(idB),
      ]);
      assert.equal(direct[0]?.id, idA);
      assert.equal(direct[1]?.status, "rejected");
      assert.equal((direct[3] as { decision: string }[]).every((row) => row.decision === "reject"), true);
    });
  });

  it("keeps concurrent same-proposal review and revision writes atomic", async () => {
    await withMigratedDatabase(async (client, pool) => {
      const repo = new PostgresProposalRepository(pool);
      const created = await submitProposal(
        repo,
        "directory.propose_claim",
        { ...claim, idempotencyKey: "iso-same" },
        "worker-a"
      );
      assert.equal(created.outcome, OUTCOME.created);
      if (created.outcome !== "created") return;
      const [reviewed, revised] = await Promise.all([
        reviewProposal(repo, { proposalId: created.proposal.id, decision: "request_changes" }, "editor-1"),
        reviseProposal(
          repo,
          {
            proposalId: created.proposal.id,
            body: { subjectId: "local-packages", claimType: "storage" },
          },
          "worker-a"
        ),
      ]);
      assert.ok(reviewed.outcome === OUTCOME.created || reviewed.outcome === OUTCOME.ambiguous);
      assert.ok(revised.outcome === OUTCOME.created || revised.outcome === OUTCOME.ambiguous);
      const proposal = await client.query("SELECT status FROM proposals WHERE id = $1", [
        created.proposal.id,
      ]);
      const reviews = await client.query(
        "SELECT decision, invalidated_at FROM proposal_reviews WHERE proposal_id = $1",
        [created.proposal.id]
      );
      const revisions = await client.query(
        "SELECT count(*)::int AS n FROM revisions WHERE proposal_id = $1",
        [created.proposal.id]
      );
      const status = proposal.rows[0].status as string;
      if (reviewed.outcome === OUTCOME.created && revised.outcome !== OUTCOME.created) {
        assert.equal(status, "changes_requested");
        assert.equal(reviews.rows.length, 1);
        assert.equal(reviews.rows[0].decision, "request_changes");
        assert.equal(revisions.rows[0].n, 1);
      } else if (revised.outcome === OUTCOME.created && reviewed.outcome !== OUTCOME.created) {
        assert.equal(status, "pending_review");
        assert.equal(reviews.rows.length, 0);
        assert.equal(revisions.rows[0].n, 2);
      } else {
        assert.equal(reviewed.outcome, OUTCOME.created);
        assert.equal(revised.outcome, OUTCOME.created);
        assert.ok(["pending_review", "changes_requested"].includes(status));
        assert.equal(reviews.rows.length, 1);
        assert.equal(revisions.rows[0].n, 2);
      }
    });
  });
});
