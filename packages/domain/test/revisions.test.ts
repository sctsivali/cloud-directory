import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CURRENT_METHODOLOGY } from "../src/scoring/methodology.ts";
import { MemoryPublicationStore } from "../src/revisions/memory.ts";
import { publishRevision } from "../src/revisions/publish.ts";
import { PUBLICATION_ERROR } from "../src/revisions/types.ts";
import { seedApprovedClaim } from "./publication-fixtures.ts";

describe("revision publication ledger", () => {
  it("publishes an approved revision as one receipt and change event", async () => {
    const store = new MemoryPublicationStore();
    const seeded = seedApprovedClaim(store);
    const result = await publishRevision(store, {
      proposalId: seeded.proposal.id,
      expectedRevisionId: seeded.revision.id,
      expectedBodyDigest: seeded.proposal.bodyDigest,
      idempotencyKey: "pub-1",
      methodologyVersion: CURRENT_METHODOLOGY.id,
      dataRevision: "drv-1",
      publisherPrincipal: "publisher-1",
      expectedCanonicalDigest: null,
    });
    assert.equal(result.outcome, "created");
    if (result.outcome !== "created") return;
    assert.equal(result.receipt.revisionId, seeded.revision.id);
    assert.equal(result.receipt.bodyDigest, seeded.proposal.bodyDigest);
    assert.equal(result.receipt.approvalDigest, seeded.approvalDigest);
    assert.equal(result.receipt.reviewerId, seeded.review.reviewerId);
    assert.equal(result.receipt.publisherId, "publisher-1");
    assert.equal(result.receipt.methodologyVersion, CURRENT_METHODOLOGY.id);
    assert.equal(result.receipt.dataRevision, "drv-1");
    assert.deepEqual(result.receipt.evidenceSnapshotIds, ["snap-1"]);
    assert.equal(result.receipt.beforeValue, null);
    assert.deepEqual(result.receipt.afterValue, { text: "KVM" });
    assert.equal(result.receipt.verificationState, "pending");
    assert.equal(result.event.revisionId, seeded.revision.id);
    assert.equal(result.event.changeType, "create");
    assert.ok(result.event.detectedAt);
    assert.ok(result.event.observedAt);
    assert.ok(result.event.reviewedAt);
    assert.ok(result.event.publishedAt);
    assert.equal(store.receipts.length, 1);
    assert.equal(store.events.length, 1);
    assert.equal(store.attempts.filter((row) => row.state === "committed").length, 1);
  });

  it("replays the same idempotency key and request digest", async () => {
    const store = new MemoryPublicationStore();
    const seeded = seedApprovedClaim(store);
    const request = {
      proposalId: seeded.proposal.id,
      expectedRevisionId: seeded.revision.id,
      expectedBodyDigest: seeded.proposal.bodyDigest,
      idempotencyKey: "pub-replay",
      methodologyVersion: CURRENT_METHODOLOGY.id,
      dataRevision: "drv-1",
      publisherPrincipal: "publisher-1",
      expectedCanonicalDigest: null,
    };
    const first = await publishRevision(store, request);
    const second = await publishRevision(store, request);
    assert.equal(first.outcome, "created");
    assert.equal(second.outcome, "replayed");
    if (first.outcome === "created" && second.outcome === "replayed") {
      assert.equal(second.receipt.id, first.receipt.id);
      assert.equal(second.event.id, first.event.id);
    }
    assert.equal(store.receipts.length, 1);
    assert.equal(store.events.length, 1);
  });

  it("replays when an identical receipt becomes visible after the initial lookup", async () => {
    class DelayedReceiptVisibilityStore extends MemoryPublicationStore {
      hideNextReceiptLookup = false;

      override async findReceiptByIdempotencyKey(key: string) {
        if (this.hideNextReceiptLookup) {
          this.hideNextReceiptLookup = false;
          return null;
        }
        return super.findReceiptByIdempotencyKey(key);
      }
    }

    const store = new DelayedReceiptVisibilityStore();
    const seeded = seedApprovedClaim(store);
    const request = {
      proposalId: seeded.proposal.id,
      expectedRevisionId: seeded.revision.id,
      expectedBodyDigest: seeded.proposal.bodyDigest,
      idempotencyKey: "pub-late-receipt",
      methodologyVersion: CURRENT_METHODOLOGY.id,
      dataRevision: "drv-1",
      publisherPrincipal: "publisher-1",
      expectedCanonicalDigest: null,
    };
    const first = await publishRevision(store, request);
    assert.equal(first.outcome, "created");

    store.hideNextReceiptLookup = true;
    const raced = await publishRevision(store, request);

    assert.equal(raced.outcome, "replayed");
    assert.equal(store.receipts.length, 1);
    assert.equal(store.events.length, 1);
  });

  it("rejects the same idempotency key with an altered request", async () => {
    const store = new MemoryPublicationStore();
    const seeded = seedApprovedClaim(store);
    const first = await publishRevision(store, {
      proposalId: seeded.proposal.id,
      expectedRevisionId: seeded.revision.id,
      expectedBodyDigest: seeded.proposal.bodyDigest,
      idempotencyKey: "pub-conflict",
      methodologyVersion: CURRENT_METHODOLOGY.id,
      dataRevision: "drv-1",
      publisherPrincipal: "publisher-1",
      expectedCanonicalDigest: null,
    });
    assert.equal(first.outcome, "created");
    const altered = await publishRevision(store, {
      proposalId: seeded.proposal.id,
      expectedRevisionId: seeded.revision.id,
      expectedBodyDigest: seeded.proposal.bodyDigest,
      idempotencyKey: "pub-conflict",
      methodologyVersion: CURRENT_METHODOLOGY.id,
      dataRevision: "drv-2",
      publisherPrincipal: "publisher-1",
      expectedCanonicalDigest: null,
    });
    assert.equal(altered.outcome, "rejected");
    if (altered.outcome === "rejected") {
      assert.equal(altered.code, PUBLICATION_ERROR.idempotencyConflict);
    }
    assert.equal(store.receipts.length, 1);
  });

  it("rejects self-publish by the proposal author", async () => {
    const store = new MemoryPublicationStore();
    const seeded = seedApprovedClaim(store);
    const result = await publishRevision(store, {
      proposalId: seeded.proposal.id,
      expectedRevisionId: seeded.revision.id,
      expectedBodyDigest: seeded.proposal.bodyDigest,
      idempotencyKey: "pub-self",
      methodologyVersion: CURRENT_METHODOLOGY.id,
      dataRevision: "drv-1",
      publisherPrincipal: seeded.proposal.actorId,
      expectedCanonicalDigest: null,
    });
    assert.equal(result.outcome, "rejected");
    if (result.outcome === "rejected") {
      assert.equal(result.code, PUBLICATION_ERROR.selfPublishForbidden);
    }
    assert.equal(store.receipts.length, 0);
    assert.equal(store.events.length, 0);
  });

  it("rejects a stale approval that is not bound to the exact revision", async () => {
    const store = new MemoryPublicationStore();
    const seeded = seedApprovedClaim(store);
    seeded.review.boundRevisionId = "other-revision";
    seeded.review.boundBodyDigest = "0".repeat(64);
    const result = await publishRevision(store, {
      proposalId: seeded.proposal.id,
      expectedRevisionId: seeded.revision.id,
      expectedBodyDigest: seeded.proposal.bodyDigest,
      idempotencyKey: "pub-stale",
      methodologyVersion: CURRENT_METHODOLOGY.id,
      dataRevision: "drv-1",
      publisherPrincipal: "publisher-1",
      expectedCanonicalDigest: null,
    });
    assert.equal(result.outcome, "rejected");
    if (result.outcome === "rejected") {
      assert.equal(result.code, PUBLICATION_ERROR.staleApproval);
    }
    assert.equal(store.receipts.length, 0);
  });

  it("rejects publish after a post-approval mutation invalidates approval", async () => {
    const store = new MemoryPublicationStore();
    const seeded = seedApprovedClaim(store);
    store.invalidateApprovals(seeded.proposal.id, new Date().toISOString());
    store.proposals.get(seeded.proposal.id)!.status = "pending_review";
    const result = await publishRevision(store, {
      proposalId: seeded.proposal.id,
      expectedRevisionId: seeded.revision.id,
      expectedBodyDigest: seeded.proposal.bodyDigest,
      idempotencyKey: "pub-mutated",
      methodologyVersion: CURRENT_METHODOLOGY.id,
      dataRevision: "drv-1",
      publisherPrincipal: "publisher-1",
      expectedCanonicalDigest: null,
    });
    assert.equal(result.outcome, "rejected");
    if (result.outcome === "rejected") {
      assert.ok(
        result.code === PUBLICATION_ERROR.approvalInvalid ||
          result.code === PUBLICATION_ERROR.staleApproval
      );
    }
    assert.equal(store.receipts.length, 0);
  });

  it("compare-and-set rejects a stale canonical digest", async () => {
    const store = new MemoryPublicationStore();
    const seeded = seedApprovedClaim(store);
    const result = await publishRevision(store, {
      proposalId: seeded.proposal.id,
      expectedRevisionId: seeded.revision.id,
      expectedBodyDigest: seeded.proposal.bodyDigest,
      idempotencyKey: "pub-cas",
      methodologyVersion: CURRENT_METHODOLOGY.id,
      dataRevision: "drv-1",
      publisherPrincipal: "publisher-1",
      expectedCanonicalDigest: "a".repeat(64),
    });
    assert.equal(result.outcome, "rejected");
    if (result.outcome === "rejected") {
      assert.equal(result.code, PUBLICATION_ERROR.casConflict);
    }
    assert.equal(store.receipts.length, 0);
  });

  it("returns a durable ambiguous outcome after a crash and never blind-retries", async () => {
    const store = new MemoryPublicationStore();
    const seeded = seedApprovedClaim(store);
    store.failAfterWrites = 1;
    const request = {
      proposalId: seeded.proposal.id,
      expectedRevisionId: seeded.revision.id,
      expectedBodyDigest: seeded.proposal.bodyDigest,
      idempotencyKey: "pub-crash",
      methodologyVersion: CURRENT_METHODOLOGY.id,
      dataRevision: "drv-1",
      publisherPrincipal: "publisher-1",
      expectedCanonicalDigest: null,
    };
    const crashed = await publishRevision(store, request);
    assert.equal(crashed.outcome, "ambiguous");
    if (crashed.outcome === "ambiguous") {
      assert.equal(crashed.code, "commit_uncertain");
      assert.equal(crashed.idempotencyKey, "pub-crash");
    }
    assert.equal(store.receipts.length, 0);
    assert.equal(store.events.length, 0);
    const retry = await publishRevision(store, request);
    assert.equal(retry.outcome, "ambiguous");
    assert.equal(store.receipts.length, 0);
    assert.equal(store.events.length, 0);
    assert.ok(store.attempts.some((row) => row.idempotencyKey === "pub-crash"));
  });

  it("rejects publish when revise/approval invalidation interleaves after prevalidation", async () => {
    const store = new MemoryPublicationStore();
    const seeded = seedApprovedClaim(store);
    store.beforeCommit = () => {
      const proposal = store.proposals.get(seeded.proposal.id)!;
      proposal.status = "pending_review";
      proposal.bodyDigest = "b".repeat(64);
      proposal.body = { ...proposal.body, value: { text: "Xen" } };
      store.invalidateApprovals(seeded.proposal.id, "2026-09-09T06:00:00.000Z");
    };
    const result = await publishRevision(store, {
      proposalId: seeded.proposal.id,
      expectedRevisionId: seeded.revision.id,
      expectedBodyDigest: seeded.proposal.bodyDigest,
      idempotencyKey: "pub-interleave",
      methodologyVersion: CURRENT_METHODOLOGY.id,
      dataRevision: "drv-1",
      publisherPrincipal: "publisher-1",
      expectedCanonicalDigest: null,
    });
    assert.equal(result.outcome, "rejected");
    if (result.outcome === "rejected") {
      assert.ok(
        result.code === PUBLICATION_ERROR.approvalInvalid ||
          result.code === PUBLICATION_ERROR.staleApproval ||
          result.code === PUBLICATION_ERROR.revisionMismatch
      );
    }
    assert.equal(store.receipts.length, 0);
    assert.equal(store.events.length, 0);
    assert.equal(store.canonical.size, 0);
  });

  it("does not let recordUncertainAttempt downgrade a committed attempt or overwrite identity", async () => {
    const store = new MemoryPublicationStore();
    const seeded = seedApprovedClaim(store);
    const created = await publishRevision(store, {
      proposalId: seeded.proposal.id,
      expectedRevisionId: seeded.revision.id,
      expectedBodyDigest: seeded.proposal.bodyDigest,
      idempotencyKey: "pub-attempt",
      methodologyVersion: CURRENT_METHODOLOGY.id,
      dataRevision: "drv-1",
      publisherPrincipal: "publisher-1",
      expectedCanonicalDigest: null,
    });
    assert.equal(created.outcome, "created");
    const committed = store.attempts.find((row) => row.idempotencyKey === "pub-attempt");
    assert.equal(committed?.state, "committed");
    const digest = committed!.requestDigest;
    await store.recordUncertainAttempt({
      id: committed!.id,
      idempotencyKey: "pub-attempt",
      requestDigest: digest,
      proposalId: seeded.proposal.id,
      revisionId: seeded.revision.id,
      publisherId: "publisher-1",
      state: "uncertain",
      createdAt: committed!.createdAt,
      updatedAt: new Date().toISOString(),
    });
    assert.equal(store.attempts.find((row) => row.idempotencyKey === "pub-attempt")?.state, "committed");
    await assert.rejects(
      () =>
        store.recordUncertainAttempt({
          id: "att_other",
          idempotencyKey: "pub-attempt",
          requestDigest: "c".repeat(64),
          proposalId: seeded.proposal.id,
          revisionId: seeded.revision.id,
          publisherId: "publisher-2",
          state: "uncertain",
          createdAt: committed!.createdAt,
          updatedAt: new Date().toISOString(),
        }),
      /identity mismatch/
    );
    const after = store.attempts.find((row) => row.idempotencyKey === "pub-attempt")!;
    assert.equal(after.state, "committed");
    assert.equal(after.requestDigest, digest);
    assert.equal(after.proposalId, seeded.proposal.id);
    assert.equal(store.receipts.length, 1);
  });
});
