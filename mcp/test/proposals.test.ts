import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bodyDigest, proposalBodyForDigest } from "../src/digest.ts";
import { ERROR_CODE, OUTCOME } from "../src/errors.ts";
import { PostgresProposalRepository } from "../src/pg-store.ts";
import { submitProposal, validateProposalInput } from "../src/proposal-tools.ts";
import { approveProposal, reviseProposal } from "../src/review-tools.ts";
import { MemoryProposalRepository } from "../src/store.ts";
import { TEST_DATABASE_URL, withMigratedDatabase } from "./pg-harness.ts";

const validClaim = {
  idempotencyKey: "claim-1",
  subjectType: "provider",
  subjectId: "local-packages",
  claimType: "hypervisor",
  value: { text: "KVM" },
  knowledgeState: "present",
  assessmentState: "extracted",
};

describe("proposal payload validation", () => {
  it("rejects malformed model output and generic SQL fields", () => {
    const missing = validateProposalInput("directory.propose_claim", { subjectType: "provider" });
    assert.equal("outcome" in missing && missing.outcome, "rejected");
    if ("code" in missing) assert.equal(missing.code, ERROR_CODE.malformedPayload);

    const sql = validateProposalInput("directory.propose_claim", {
      ...validClaim,
      sql: "DELETE FROM providers",
    });
    assert.equal("outcome" in sql && sql.outcome, "rejected");

    const unknownVerified = validateProposalInput("directory.propose_claim", {
      ...validClaim,
      knowledgeState: "unknown",
      assessmentState: "independently_verified",
    });
    assert.equal("outcome" in unknownVerified && unknownVerified.outcome, "rejected");
  });

  it("binds idempotency to a canonical body digest", () => {
    const a = proposalBodyForDigest("directory.propose_claim", validClaim);
    const b = proposalBodyForDigest("directory.propose_claim", {
      idempotencyKey: "other-key",
      subjectType: validClaim.subjectType,
      subjectId: validClaim.subjectId,
      claimType: validClaim.claimType,
      value: validClaim.value,
      knowledgeState: validClaim.knowledgeState,
      assessmentState: validClaim.assessmentState,
    });
    assert.equal(bodyDigest(a), bodyDigest(b));
    const altered = proposalBodyForDigest("directory.propose_claim", {
      ...validClaim,
      value: { text: "Xen" },
    });
    assert.notEqual(bodyDigest(a), bodyDigest(altered));
  });
});

describe("in-memory proposal workflow", () => {
  it("replays the same key and body and rejects an altered body", async () => {
    const repo = new MemoryProposalRepository();
    const first = await submitProposal(repo, "directory.propose_claim", validClaim, "worker-a");
    assert.equal(first.outcome, OUTCOME.created);
    const replay = await submitProposal(repo, "directory.propose_claim", validClaim, "worker-a");
    assert.equal(replay.outcome, OUTCOME.replayed);
    if (first.outcome === "created" && replay.outcome === "replayed") {
      assert.equal(replay.proposal.id, first.proposal.id);
    }
    const altered = await submitProposal(repo, "directory.propose_claim", {
      ...validClaim,
      value: { text: "Xen" },
    }, "worker-a");
    assert.equal(altered.outcome, OUTCOME.rejected);
    if (altered.outcome === "rejected") {
      assert.equal(altered.code, ERROR_CODE.idempotencyConflict);
    }
    assert.equal((await repo.findByIdempotencyKey("claim-1"))?.bodyDigest, (first as { proposal: { bodyDigest: string } }).proposal.bodyDigest);
  });

  it("forbids self-approval and invalidates approval after a revision", async () => {
    const repo = new MemoryProposalRepository();
    const created = await submitProposal(repo, "directory.propose_claim", validClaim, "worker-a");
    assert.equal(created.outcome, OUTCOME.created);
    if (created.outcome !== "created") return;
    const self = await approveProposal(repo, {
      proposalId: created.proposal.id,
    }, "worker-a");
    assert.equal(self.outcome, OUTCOME.rejected);
    if (self.outcome === "rejected") {
      assert.equal(self.code, ERROR_CODE.selfApprovalForbidden);
    }
    const approved = await approveProposal(repo, {
      proposalId: created.proposal.id,
    }, "editor-1");
    assert.equal(approved.outcome, OUTCOME.created);
    if (approved.outcome === "created") {
      assert.equal(approved.proposal.status, "approved");
    }
    const revised = await reviseProposal(repo, {
      proposalId: created.proposal.id,
      body: { ...created.proposal.body, value: { text: "KVM-updated" } },
    }, "worker-a");
    assert.equal(revised.outcome, OUTCOME.created);
    if (revised.outcome === "created") {
      assert.equal(revised.proposal.status, "pending_review");
    }
    const reviews = await repo.listReviews(created.proposal.id);
    const approvals = reviews.filter((row) => row.decision === "approve");
    assert.equal(approvals.length, 1);
    assert.ok(approvals[0].invalidatedAt);
  });

  it("returns an explicit ambiguous outcome instead of inserting a duplicate", async () => {
    const repo = new MemoryProposalRepository();
    repo.failNextInsert = "uncertain";
    const result = await submitProposal(repo, "directory.propose_claim", {
      ...validClaim,
      idempotencyKey: "claim-ambiguous",
    }, "worker-a");
    assert.equal(result.outcome, OUTCOME.ambiguous);
    if (result.outcome === "ambiguous") {
      assert.equal(result.code, "commit_uncertain");
    }
    assert.equal(await repo.findByIdempotencyKey("claim-ambiguous"), null);
    const created = await submitProposal(repo, "directory.propose_claim", {
      ...validClaim,
      idempotencyKey: "claim-ambiguous",
    }, "worker-a");
    assert.equal(created.outcome, OUTCOME.created);
  });
});

describe("PostgreSQL durable proposals", { skip: !TEST_DATABASE_URL }, () => {
  it("persists digest-bound idempotency, self-approval, and approval invalidation", async () => {
    await withMigratedDatabase(async (client, pool) => {
      const repo = new PostgresProposalRepository(pool);
      const first = await submitProposal(repo, "directory.propose_claim", {
        ...validClaim,
        idempotencyKey: "pg-claim-1",
      }, "worker-a");
      assert.equal(first.outcome, OUTCOME.created);
      const replay = await submitProposal(repo, "directory.propose_claim", {
        ...validClaim,
        idempotencyKey: "pg-claim-1",
      }, "worker-a");
      assert.equal(replay.outcome, OUTCOME.replayed);
      const altered = await submitProposal(repo, "directory.propose_claim", {
        ...validClaim,
        idempotencyKey: "pg-claim-1",
        value: { text: "changed" },
      }, "worker-a");
      assert.equal(altered.outcome, OUTCOME.rejected);
      if (first.outcome !== "created") return;
      const self = await approveProposal(repo, {
        proposalId: first.proposal.id,
      }, "worker-a");
      assert.equal(self.outcome, OUTCOME.rejected);
      const approved = await approveProposal(repo, {
        proposalId: first.proposal.id,
      }, "editor-1");
      assert.equal(approved.outcome, OUTCOME.created);
      const revised = await reviseProposal(repo, {
        proposalId: first.proposal.id,
        body: { subjectId: "local-packages", claimType: "hypervisor" },
      }, "worker-a");
      assert.equal(revised.outcome, OUTCOME.created);
      if (revised.outcome === "created") {
        assert.equal(revised.proposal.status, "pending_review");
      }
      const reviews = await repo.listReviews(first.proposal.id);
      assert.ok(reviews.some((row) => row.decision === "approve" && row.invalidatedAt != null));
      const count = await client.query("SELECT count(*)::int AS n FROM proposals");
      assert.equal(count.rows[0].n, 1);
    });
  });
});
