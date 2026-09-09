import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CURRENT_METHODOLOGY } from "../src/scoring/methodology.ts";
import { bodyDigestFromValue } from "../src/revisions/digest.ts";
import { MemoryPublicationStore } from "../src/revisions/memory.ts";
import { publishRevision } from "../src/revisions/publish.ts";
import { PUBLICATION_ERROR } from "../src/revisions/types.ts";
import { verifyPublication } from "../src/revisions/verify.ts";
import { seedApprovedClaim } from "./publication-fixtures.ts";

describe("S3 replay resolvers require exact request identity", () => {
  it("rejects another principal's idempotency key instead of replaying their receipt", async () => {
    const store = new MemoryPublicationStore();
    const seeded = seedApprovedClaim(store);
    const first = await publishRevision(store, {
      proposalId: seeded.proposal.id,
      expectedRevisionId: seeded.revision.id,
      expectedBodyDigest: seeded.proposal.bodyDigest,
      idempotencyKey: "shared-key",
      methodologyVersion: CURRENT_METHODOLOGY.id,
      dataRevision: "drv-1",
      publisherPrincipal: "publisher-1",
      expectedCanonicalDigest: null,
    });
    assert.equal(first.outcome, "created");
    const collision = await publishRevision(store, {
      proposalId: seeded.proposal.id,
      expectedRevisionId: seeded.revision.id,
      expectedBodyDigest: seeded.proposal.bodyDigest,
      idempotencyKey: "shared-key",
      methodologyVersion: CURRENT_METHODOLOGY.id,
      dataRevision: "drv-1",
      publisherPrincipal: "publisher-2",
      expectedCanonicalDigest: seeded.proposal.bodyDigest,
    });
    assert.equal(collision.outcome, "rejected");
    if (collision.outcome === "rejected") {
      assert.equal(collision.code, PUBLICATION_ERROR.idempotencyConflict);
    }
    assert.equal(store.receipts.length, 1);
    assert.equal(store.receipts[0]!.publisherId, "publisher-1");
  });

  it("does not treat an uncertain commit of a different identity as a replay", async () => {
    const store = new MemoryPublicationStore();
    const seeded = seedApprovedClaim(store);
    store.failAfterWrites = 2;
    const uncertain = await publishRevision(store, {
      proposalId: seeded.proposal.id,
      expectedRevisionId: seeded.revision.id,
      expectedBodyDigest: seeded.proposal.bodyDigest,
      idempotencyKey: "uncertain-key",
      methodologyVersion: CURRENT_METHODOLOGY.id,
      dataRevision: "drv-1",
      publisherPrincipal: "publisher-1",
      expectedCanonicalDigest: null,
    });
    assert.equal(uncertain.outcome, "ambiguous");
    const collision = await publishRevision(store, {
      proposalId: seeded.proposal.id,
      expectedRevisionId: seeded.revision.id,
      expectedBodyDigest: seeded.proposal.bodyDigest,
      idempotencyKey: "uncertain-key",
      methodologyVersion: CURRENT_METHODOLOGY.id,
      dataRevision: "drv-2",
      publisherPrincipal: "publisher-2",
      expectedCanonicalDigest: null,
    });
    assert.equal(collision.outcome, "rejected");
    if (collision.outcome === "rejected") {
      assert.equal(collision.code, PUBLICATION_ERROR.idempotencyConflict);
    }
  });

  it("refuses to replay a verification for a different principal", async () => {
    const store = new MemoryPublicationStore();
    const seeded = seedApprovedClaim(store);
    const published = await publishRevision(store, {
      proposalId: seeded.proposal.id,
      expectedRevisionId: seeded.revision.id,
      expectedBodyDigest: seeded.proposal.bodyDigest,
      idempotencyKey: "verify-id",
      methodologyVersion: CURRENT_METHODOLOGY.id,
      dataRevision: "drv-1",
      publisherPrincipal: "publisher-1",
      expectedCanonicalDigest: null,
    });
    assert.equal(published.outcome, "created");
    if (published.outcome !== "created") return;
    const digest = bodyDigestFromValue(published.receipt.afterValue);
    const first = await verifyPublication(store, {
      receiptId: published.receipt.id,
      eventId: published.event.id,
      expectedValueDigest: digest,
      expectedDataRevision: published.receipt.dataRevision,
      verifierPrincipal: "verifier-1",
    });
    assert.equal(first.outcome, "created");
    const other = await verifyPublication(store, {
      receiptId: published.receipt.id,
      eventId: published.event.id,
      expectedValueDigest: digest,
      expectedDataRevision: published.receipt.dataRevision,
      verifierPrincipal: "verifier-2",
    });
    assert.equal(other.outcome, "rejected");
    assert.equal(store.receipts[0]!.verifiedBy, "verifier-1");
  });
});
