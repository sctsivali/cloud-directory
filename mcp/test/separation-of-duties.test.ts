import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CURRENT_METHODOLOGY } from "../../packages/domain/src/scoring/methodology.ts";
import { bodyDigestFromValue } from "../../packages/domain/src/revisions/digest.ts";
import { MemoryPublicationStore } from "../../packages/domain/src/revisions/memory.ts";
import { publishRevision } from "../../packages/domain/src/revisions/publish.ts";
import { PUBLICATION_ERROR } from "../../packages/domain/src/revisions/types.ts";
import { verifyPublication } from "../../packages/domain/src/revisions/verify.ts";
import { ERROR_CODE, OUTCOME } from "../src/errors.ts";
import { PostgresProposalRepository } from "../src/pg-store.ts";
import { PostgresPublicationStore } from "../src/pg-publication.ts";
import { submitProposal } from "../src/proposal-tools.ts";
import { approveProposal, reviseProposal } from "../src/review-tools.ts";
import { MemoryProposalRepository } from "../src/store.ts";
import { claimRevisionBody } from "./claim-body.ts";
import { TEST_DATABASE_URL, withMigratedDatabase } from "./pg-harness.ts";

describe("S2 separation of duties binds revision author", () => {
  it("forbids the revision author from approving their own revision", async () => {
    const repo = new MemoryProposalRepository();
    const created = await submitProposal(
      repo,
      "directory.propose_claim",
      { idempotencyKey: "sod-approve", ...claimRevisionBody() },
      "worker-a"
    );
    assert.equal(created.outcome, OUTCOME.created);
    if (created.outcome !== "created") return;
    const revised = await reviseProposal(
      repo,
      { proposalId: created.proposal.id, body: claimRevisionBody({ value: { text: "KVM-2" } }) },
      "editor-1"
    );
    assert.equal(revised.outcome, OUTCOME.created);
    const self = await approveProposal(repo, { proposalId: created.proposal.id }, "editor-1");
    assert.equal(self.outcome, OUTCOME.rejected);
    if (self.outcome === "rejected") assert.equal(self.code, ERROR_CODE.selfApprovalForbidden);
    const proposer = await approveProposal(repo, { proposalId: created.proposal.id }, "worker-a");
    assert.equal(proposer.outcome, OUTCOME.rejected);
    const ok = await approveProposal(repo, { proposalId: created.proposal.id }, "editor-2");
    assert.equal(ok.outcome, OUTCOME.created);
  });

  it("forbids the revision author from publishing or verifying their own revision", async () => {
    const store = new MemoryPublicationStore();
    const now = "2026-09-09T04:00:00.000Z";
    const body = {
      toolName: "directory.propose_claim",
      ...claimRevisionBody({
        assessmentState: "independently_verified",
        observedAt: "2026-09-01T00:00:00.000Z",
        snapshotId: "snap-1",
      }),
    };
    const digest = bodyDigestFromValue(body);
    store.seedProposal(
      {
        id: "prop-sod",
        toolName: "directory.propose_claim",
        actorId: "worker-a",
        idempotencyKey: "sod-pub",
        body,
        bodyDigest: digest,
        status: "approved",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "rev-sod",
        proposalId: "prop-sod",
        revisionOrdinal: 2,
        body,
        bodyDigest: digest,
        actorId: "reviser-1",
        createdAt: now,
      },
      {
        id: "appr-sod",
        proposalId: "prop-sod",
        reviewerId: "editor-2",
        decision: "approve",
        comment: null,
        createdAt: now,
        invalidatedAt: null,
        boundRevisionId: "rev-sod",
        boundBodyDigest: digest,
      }
    );
    const asReviser = await publishRevision(store, {
      proposalId: "prop-sod",
      expectedRevisionId: "rev-sod",
      expectedBodyDigest: digest,
      idempotencyKey: "sod-pub-rev",
      methodologyVersion: CURRENT_METHODOLOGY.id,
      dataRevision: "drv-1",
      publisherPrincipal: "reviser-1",
      expectedCanonicalDigest: null,
    });
    assert.equal(asReviser.outcome, "rejected");
    if (asReviser.outcome === "rejected") assert.equal(asReviser.code, PUBLICATION_ERROR.selfPublishForbidden);

    const published = await publishRevision(store, {
      proposalId: "prop-sod",
      expectedRevisionId: "rev-sod",
      expectedBodyDigest: digest,
      idempotencyKey: "sod-pub-ok",
      methodologyVersion: CURRENT_METHODOLOGY.id,
      dataRevision: "drv-1",
      publisherPrincipal: "publisher-1",
      expectedCanonicalDigest: null,
    });
    assert.equal(published.outcome, "created");
    if (published.outcome !== "created") return;
    const verifyReviser = await verifyPublication(store, {
      receiptId: published.receipt.id,
      eventId: published.event.id,
      expectedValueDigest: bodyDigestFromValue(published.receipt.afterValue),
      expectedDataRevision: published.receipt.dataRevision,
      verifierPrincipal: "reviser-1",
    });
    assert.equal(verifyReviser.outcome, "rejected");
    if (verifyReviser.outcome === "rejected") {
      assert.equal(verifyReviser.code, PUBLICATION_ERROR.selfVerifyForbidden);
    }
    const verifyProposer = await verifyPublication(store, {
      receiptId: published.receipt.id,
      eventId: published.event.id,
      expectedValueDigest: bodyDigestFromValue(published.receipt.afterValue),
      expectedDataRevision: published.receipt.dataRevision,
      verifierPrincipal: "worker-a",
    });
    assert.equal(verifyProposer.outcome, "rejected");
  });
});

describe("S2 PostgreSQL SoD constraints", { skip: !TEST_DATABASE_URL }, () => {
  it("rejects direct-DB self-approval by the latest revision author", async () => {
    await withMigratedDatabase(async (client, pool) => {
      const repo = new PostgresProposalRepository(pool);
      const created = await submitProposal(
        repo,
        "directory.propose_claim",
        { idempotencyKey: "pg-sod-rev", ...claimRevisionBody() },
        "worker-a"
      );
      assert.equal(created.outcome, OUTCOME.created);
      if (created.outcome !== "created") return;
      const revised = await reviseProposal(
        repo,
        { proposalId: created.proposal.id, body: claimRevisionBody({ value: { text: "KVM-db" } }) },
        "editor-1"
      );
      assert.equal(revised.outcome, OUTCOME.created);
      const latest = await client.query(
        "SELECT id, actor_id, body_digest FROM revisions WHERE proposal_id = $1 ORDER BY revision_ordinal DESC LIMIT 1",
        [created.proposal.id]
      );
      await assert.rejects(
        () =>
          client.query(
            `INSERT INTO proposal_reviews (
               id, proposal_id, reviewer_id, decision, comment, created_at, bound_revision_id, bound_body_digest
             ) VALUES ($1,$2,$3,'approve',null,now(),$4,$5)`,
            ["revw-sod", created.proposal.id, "editor-1", latest.rows[0].id, latest.rows[0].body_digest]
          ),
        /self-approve|revision author/i
      );
      const publication = new PostgresPublicationStore(pool);
      const approved = await approveProposal(repo, { proposalId: created.proposal.id }, "editor-2");
      assert.equal(approved.outcome, OUTCOME.created);
      const asReviser = await publishRevision(publication, {
        proposalId: created.proposal.id,
        expectedRevisionId: String(latest.rows[0].id),
        expectedBodyDigest: String(latest.rows[0].body_digest),
        idempotencyKey: "pg-sod-pub",
        methodologyVersion: CURRENT_METHODOLOGY.id,
        dataRevision: "drv-1",
        publisherPrincipal: "editor-1",
        expectedCanonicalDigest: null,
      });
      assert.equal(asReviser.outcome, "rejected");
    });
  });
});
