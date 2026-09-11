import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ERROR_CODE, OUTCOME } from "../src/errors.ts";
import { executeTool } from "../src/handlers.ts";
import { submitProposal } from "../src/proposal-tools.ts";
import { approveProposal, reviewProposal, reviseProposal } from "../src/review-tools.ts";
import type { Capability } from "../../packages/contracts/src/mcp.ts";
import { createDirectoryMcpServer } from "../src/server.ts";
import { MemoryProposalRepository } from "../src/store.ts";
import { claimRevisionBody } from "./claim-body.ts";

const claimBody = {
  idempotencyKey: "bind-claim-1",
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

function server(
  principalId: string,
  repo: MemoryProposalRepository,
  capabilities: readonly Capability[] = ["propose", "review", "approve"]
) {
  return createDirectoryMcpServer({
    capabilities: [...capabilities],
    context: { reader: null, repo, principalId },
  });
}

describe("non-model-controlled principal binding", () => {
  it("rejects model-supplied actorId and reviewerId at the tool boundary", async () => {
    const repo = new MemoryProposalRepository();
    const handle = server("worker-a", repo);
    const proposed = payloadOf(
      await handle.invoke("directory.propose_claim", {
        ...claimBody,
        actorId: "victim-editor",
      })
    );
    assert.equal(proposed.outcome, OUTCOME.rejected);
    assert.equal(proposed.code, ERROR_CODE.malformedPayload);
    assert.equal(await repo.findByIdempotencyKey(claimBody.idempotencyKey), null);

    const created = await submitProposal(repo, "directory.propose_claim", claimBody, "worker-a");
    assert.equal(created.outcome, OUTCOME.created);
    if (created.outcome !== "created") return;

    const spoofedReview = payloadOf(
      await handle.invoke("directory.review_proposal", {
        proposalId: created.proposal.id,
        reviewerId: "editor-1",
        decision: "reject",
      })
    );
    assert.equal(spoofedReview.outcome, OUTCOME.rejected);
    assert.equal(spoofedReview.code, ERROR_CODE.malformedPayload);

    const spoofedApprove = payloadOf(
      await handle.invoke("directory.approve_proposal", {
        proposalId: created.proposal.id,
        reviewerId: "editor-1",
      })
    );
    assert.equal(spoofedApprove.outcome, OUTCOME.rejected);
    assert.equal(spoofedApprove.code, ERROR_CODE.malformedPayload);
    assert.equal((await repo.findById(created.proposal.id))?.status, "pending_review");
    assert.equal((await repo.listReviews(created.proposal.id)).length, 0);
  });

  it("stores the bound principalId even when propose/review/revise are called directly", async () => {
    const repo = new MemoryProposalRepository();
    const created = await submitProposal(
      repo,
      "directory.propose_claim",
      { ...claimBody, actorId: "impersonated-user", idempotencyKey: "direct-1" },
      "worker-a"
    );
    assert.equal(created.outcome, OUTCOME.rejected);
    assert.equal(await repo.findByIdempotencyKey("direct-1"), null);

    const bound = await submitProposal(
      repo,
      "directory.propose_claim",
      { ...claimBody, idempotencyKey: "direct-1" },
      "worker-a"
    );
    assert.equal(bound.outcome, OUTCOME.created);
    if (bound.outcome !== "created") return;
    assert.equal(bound.proposal.actorId, "worker-a");
    assert.equal((await repo.listRevisions(bound.proposal.id))[0]?.actorId, "worker-a");

    const revised = await reviseProposal(
      repo,
      {
        proposalId: bound.proposal.id,
        actorId: "other-principal",
        body: { subjectId: "local-packages", claimType: "hypervisor" },
      },
      "worker-a"
    );
    assert.equal(revised.outcome, OUTCOME.rejected);

    const okRevise = await reviseProposal(
      repo,
      {
        proposalId: bound.proposal.id,
        body: claimRevisionBody(),
      },
      "worker-a"
    );
    assert.equal(okRevise.outcome, OUTCOME.created);
    const revisions = await repo.listRevisions(bound.proposal.id);
    assert.equal(revisions.at(-1)?.actorId, "worker-a");
  });

  it("blocks self-approval when the model spoofs reviewerId with case or whitespace variants", async () => {
    const repo = new MemoryProposalRepository();
    const proposer = server("worker-a", repo, ["propose"]);
    const created = payloadOf(
      await proposer.invoke("directory.propose_claim", { ...claimBody, idempotencyKey: "self-1" })
    );
    assert.equal(created.outcome, OUTCOME.created);
    const proposalId = (created.proposal as { id: string }).id;
    assert.equal((created.proposal as { actorId: string }).actorId, "worker-a");

    const boundApprover = server("worker-a", repo, ["approve"]);
    const variants = ["editor-1", "Worker-A", "WORKER-A", " worker-a", "worker-a ", "worker-a"];
    for (const reviewerId of variants) {
      const direct = payloadOf(
        await boundApprover.invoke("directory.approve_proposal", { proposalId, reviewerId })
      );
      assert.equal(direct.outcome, OUTCOME.rejected, reviewerId);
      assert.ok(
        direct.code === ERROR_CODE.selfApprovalForbidden ||
          direct.code === ERROR_CODE.malformedPayload,
        `${reviewerId} => ${String(direct.code)}`
      );
    }

    const samePrincipal = server("worker-a", repo, ["approve"]);
    const selfApprove = payloadOf(await samePrincipal.invoke("directory.approve_proposal", { proposalId }));
    assert.equal(selfApprove.outcome, OUTCOME.rejected);
    assert.equal(selfApprove.code, ERROR_CODE.selfApprovalForbidden);

    const viaExecute = await executeTool(
      { reader: null, repo, principalId: "worker-a" },
      "directory.approve_proposal",
      { proposalId, reviewerId: "editor-1" }
    );
    const executed = payloadOf(viaExecute);
    assert.equal(executed.outcome, OUTCOME.rejected);
    assert.ok(
      executed.code === ERROR_CODE.selfApprovalForbidden ||
        executed.code === ERROR_CODE.malformedPayload
    );
    assert.equal((await repo.findById(proposalId))?.status, "pending_review");
  });

  it("allows a different bound principal to approve and records that reviewerId", async () => {
    const repo = new MemoryProposalRepository();
    const created = await submitProposal(
      repo,
      "directory.propose_claim",
      { ...claimBody, idempotencyKey: "cross-1" },
      "worker-a"
    );
    assert.equal(created.outcome, OUTCOME.created);
    if (created.outcome !== "created") return;

    const editor = server("editor-1", repo, ["approve"]);
    const approved = payloadOf(
      await editor.invoke("directory.approve_proposal", { proposalId: created.proposal.id })
    );
    assert.equal(approved.outcome, OUTCOME.created);
    assert.equal((approved.proposal as { status: string }).status, "approved");
    const reviews = await repo.listReviews(created.proposal.id);
    assert.equal(reviews[0]?.reviewerId, "editor-1");
    assert.equal(reviews[0]?.decision, "approve");
  });

  it("rejects a non-canonical principalId on the server and on mutation tools", async () => {
    const repo = new MemoryProposalRepository();
    assert.throws(
      () => server("Worker-A", repo),
      /canonical|principalId/i
    );
    assert.throws(
      () => server(" worker-a ", repo),
      /canonical|principalId/i
    );

    const created = await submitProposal(
      repo,
      "directory.propose_claim",
      { ...claimBody, idempotencyKey: "canon-1" },
      "Worker-A"
    );
    assert.equal(created.outcome, OUTCOME.rejected);
    if (created.outcome === "rejected") {
      assert.equal(created.code, ERROR_CODE.invalidPrincipal);
    }

    const review = await reviewProposal(
      repo,
      { proposalId: "missing", decision: "reject" },
      " editor-1 "
    );
    assert.equal(review.outcome, OUTCOME.rejected);
    if (review.outcome === "rejected") {
      assert.equal(review.code, ERROR_CODE.invalidPrincipal);
    }
  });
});
