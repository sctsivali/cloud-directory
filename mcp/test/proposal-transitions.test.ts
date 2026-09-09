import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ERROR_CODE, OUTCOME } from "../src/errors.ts";
import { PostgresProposalRepository } from "../src/pg-store.ts";
import { submitProposal } from "../src/proposal-tools.ts";
import { approveProposal, reviewProposal, reviseProposal } from "../src/review-tools.ts";
import {
  MemoryProposalRepository,
  proposalStatusTransitionAllowed,
} from "../src/store.ts";
import { claimRevisionBody } from "./claim-body.ts";
import { TEST_DATABASE_URL, withMigratedDatabase } from "./pg-harness.ts";

describe("L9 proposal state-transition matrix", () => {
  it("allows only documented transitions and treats published/rejected as terminal except revision", () => {
    assert.equal(proposalStatusTransitionAllowed("pending_review", "approved"), true);
    assert.equal(proposalStatusTransitionAllowed("pending_review", "rejected"), true);
    assert.equal(proposalStatusTransitionAllowed("approved", "published"), true);
    assert.equal(proposalStatusTransitionAllowed("approved", "pending_review"), true);
    assert.equal(proposalStatusTransitionAllowed("rejected", "pending_review"), true);
    assert.equal(proposalStatusTransitionAllowed("published", "pending_review"), true);
    assert.equal(proposalStatusTransitionAllowed("published", "approved"), false);
    assert.equal(proposalStatusTransitionAllowed("published", "rejected"), false);
    assert.equal(proposalStatusTransitionAllowed("rejected", "approved"), false);
    assert.equal(proposalStatusTransitionAllowed("rejected", "published"), false);
    assert.equal(proposalStatusTransitionAllowed("approved", "rejected"), false);
  });

  it("locks and binds the latest revision digest on approve, and refuses terminal overwrites", async () => {
    const repo = new MemoryProposalRepository();
    const created = await submitProposal(
      repo,
      "directory.propose_claim",
      { idempotencyKey: "l9-bind", ...claimRevisionBody() },
      "worker-a"
    );
    assert.equal(created.outcome, OUTCOME.created);
    if (created.outcome !== "created") return;
    const revised = await reviseProposal(
      repo,
      { proposalId: created.proposal.id, body: claimRevisionBody({ value: { text: "KVM-rev" } }) },
      "worker-a"
    );
    assert.equal(revised.outcome, OUTCOME.created);
    const approved = await approveProposal(repo, { proposalId: created.proposal.id }, "editor-1");
    assert.equal(approved.outcome, OUTCOME.created);
    if (approved.outcome !== "created") return;
    const reviews = await repo.listReviews(created.proposal.id);
    const approval = reviews.find((row) => row.decision === "approve");
    const latest = (await repo.listRevisions(created.proposal.id)).at(-1);
    assert.equal(approval?.boundRevisionId, latest?.id);
    assert.equal(approval?.boundBodyDigest, latest?.bodyDigest);
    assert.equal(approval?.boundBodyDigest, approved.proposal.bodyDigest);

    const rejectApproved = await reviewProposal(
      repo,
      { proposalId: created.proposal.id, decision: "reject" },
      "editor-2"
    );
    assert.equal(rejectApproved.outcome, OUTCOME.rejected);
    if (rejectApproved.outcome === "rejected") {
      assert.equal(rejectApproved.code, ERROR_CODE.illegalStateTransition);
    }
    assert.equal((await repo.findById(created.proposal.id))?.status, "approved");
  });

  it("reopens rejected proposals only through revision, not a second review", async () => {
    const repo = new MemoryProposalRepository();
    const created = await submitProposal(
      repo,
      "directory.propose_claim",
      { idempotencyKey: "l9-reject", ...claimRevisionBody() },
      "worker-a"
    );
    assert.equal(created.outcome, OUTCOME.created);
    if (created.outcome !== "created") return;
    const rejected = await reviewProposal(
      repo,
      { proposalId: created.proposal.id, decision: "reject" },
      "editor-1"
    );
    assert.equal(rejected.outcome, OUTCOME.created);
    const approveRejected = await approveProposal(repo, { proposalId: created.proposal.id }, "editor-2");
    assert.equal(approveRejected.outcome, OUTCOME.rejected);
    const rereject = await reviewProposal(
      repo,
      { proposalId: created.proposal.id, decision: "request_changes" },
      "editor-2"
    );
    assert.equal(rereject.outcome, OUTCOME.rejected);
    const revised = await reviseProposal(
      repo,
      { proposalId: created.proposal.id, body: claimRevisionBody({ value: { text: "KVM-reopen" } }) },
      "worker-a"
    );
    assert.equal(revised.outcome, OUTCOME.created);
    if (revised.outcome === "created") assert.equal(revised.proposal.status, "pending_review");
  });
});

describe("L9 PostgreSQL transition constraints", { skip: !TEST_DATABASE_URL }, () => {
  it("blocks direct-DB overwrites of published and rejected status", async () => {
    await withMigratedDatabase(async (client, pool) => {
      const repo = new PostgresProposalRepository(pool);
      const created = await submitProposal(
        repo,
        "directory.propose_claim",
        { idempotencyKey: "pg-l9", ...claimRevisionBody() },
        "worker-a"
      );
      assert.equal(created.outcome, OUTCOME.created);
      if (created.outcome !== "created") return;
      const rejected = await reviewProposal(
        repo,
        { proposalId: created.proposal.id, decision: "reject" },
        "editor-1"
      );
      assert.equal(rejected.outcome, OUTCOME.created);
      await assert.rejects(
        () => client.query("UPDATE proposals SET status = 'approved' WHERE id = $1", [created.proposal.id]),
        /transition/i
      );
      const status = await client.query("SELECT status FROM proposals WHERE id = $1", [created.proposal.id]);
      assert.equal(status.rows[0].status, "rejected");

      const second = await submitProposal(
        repo,
        "directory.propose_claim",
        { idempotencyKey: "pg-l9-pub", ...claimRevisionBody({ subjectId: "global-asean" }) },
        "worker-a"
      );
      assert.equal(second.outcome, OUTCOME.created);
      if (second.outcome !== "created") return;
      const approved = await approveProposal(repo, { proposalId: second.proposal.id }, "editor-1");
      assert.equal(approved.outcome, OUTCOME.created);
      await client.query("UPDATE proposals SET status = 'published' WHERE id = $1", [second.proposal.id]);
      await assert.rejects(
        () => client.query("UPDATE proposals SET status = 'approved' WHERE id = $1", [second.proposal.id]),
        /transition/i
      );
      const bound = await client.query(
        "SELECT bound_revision_id, bound_body_digest FROM proposal_reviews WHERE proposal_id = $1 AND decision = 'approve'",
        [second.proposal.id]
      );
      const latest = await client.query(
        "SELECT id, body_digest FROM revisions WHERE proposal_id = $1 ORDER BY revision_ordinal DESC LIMIT 1",
        [second.proposal.id]
      );
      assert.equal(String(bound.rows[0].bound_revision_id), String(latest.rows[0].id));
      assert.equal(String(bound.rows[0].bound_body_digest), String(latest.rows[0].body_digest));
    });
  });
});
