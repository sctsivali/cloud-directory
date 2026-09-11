import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CURRENT_METHODOLOGY } from "../src/scoring/methodology.ts";
import { bodyDigestFromValue } from "../src/revisions/digest.ts";
import { MemoryPublicationStore } from "../src/revisions/memory.ts";
import { publishRevision } from "../src/revisions/publish.ts";
import { PUBLICATION_ERROR } from "../src/revisions/types.ts";
import { verifyPublication } from "../src/revisions/verify.ts";
import { seedApprovedClaim } from "./publication-fixtures.ts";

async function publishPending(store: MemoryPublicationStore, key = "pub-verify") {
  const seeded = seedApprovedClaim(store);
  const published = await publishRevision(store, {
    proposalId: seeded.proposal.id,
    expectedRevisionId: seeded.revision.id,
    expectedBodyDigest: seeded.proposal.bodyDigest,
    idempotencyKey: key,
    methodologyVersion: CURRENT_METHODOLOGY.id,
    dataRevision: "drv-1",
    publisherPrincipal: "publisher-1",
    expectedCanonicalDigest: null,
  });
  assert.equal(published.outcome, "created");
  if (published.outcome !== "created") throw new Error("publish failed");
  assert.equal(published.receipt.verificationState, "pending");
  return published;
}

describe("publication verification", () => {
  it("starts pending and verifies with a different canonical principal", async () => {
    const store = new MemoryPublicationStore();
    const published = await publishPending(store);
    const digest = bodyDigestFromValue(published.receipt.afterValue);
    const verified = await verifyPublication(store, {
      receiptId: published.receipt.id,
      eventId: published.event.id,
      expectedValueDigest: digest,
      expectedDataRevision: published.receipt.dataRevision,
      verifierPrincipal: "verifier-1",
    });
    assert.equal(verified.outcome, "created");
    if (verified.outcome !== "created") return;
    assert.equal(verified.receipt.verificationState, "verified");
    assert.equal(verified.receipt.verifiedBy, "verifier-1");
    assert.deepEqual(verified.receipt.afterValue, published.receipt.afterValue);
    assert.equal(store.events.length, 1);
    assert.equal(store.events[0]!.id, published.event.id);
  });

  it("rejects self-verify by the publisher", async () => {
    const store = new MemoryPublicationStore();
    const published = await publishPending(store, "pub-self-verify");
    const digest = bodyDigestFromValue(published.receipt.afterValue);
    const result = await verifyPublication(store, {
      receiptId: published.receipt.id,
      eventId: published.event.id,
      expectedValueDigest: digest,
      expectedDataRevision: published.receipt.dataRevision,
      verifierPrincipal: "publisher-1",
    });
    assert.equal(result.outcome, "rejected");
    if (result.outcome === "rejected") {
      assert.equal(result.code, PUBLICATION_ERROR.selfVerifyForbidden);
    }
    assert.equal(store.receipts[0]!.verificationState, "pending");
  });

  it("records mismatch as failed without rewriting history", async () => {
    const store = new MemoryPublicationStore();
    const published = await publishPending(store, "pub-mismatch");
    const before = structuredClone(published.receipt);
    const eventBefore = structuredClone(published.event);
    const result = await verifyPublication(store, {
      receiptId: published.receipt.id,
      eventId: published.event.id,
      expectedValueDigest: "d".repeat(64),
      expectedDataRevision: published.receipt.dataRevision,
      verifierPrincipal: "verifier-1",
    });
    assert.equal(result.outcome, "rejected");
    if (result.outcome === "rejected") {
      assert.equal(result.code, PUBLICATION_ERROR.verificationMismatch);
      assert.equal(result.receipt?.verificationState, "failed");
    }
    assert.deepEqual(store.receipts[0]!.afterValue, before.afterValue);
    assert.deepEqual(store.receipts[0]!.beforeValue, before.beforeValue);
    assert.equal(store.receipts[0]!.bodyDigest, before.bodyDigest);
    assert.equal(store.events[0]!.id, eventBefore.id);
    assert.deepEqual(store.events[0]!.newValue, eventBefore.newValue);
    assert.deepEqual(
      store.canonicalValue("provider", "local-packages", "hypervisor"),
      published.receipt.afterValue
    );
  });

  it("replays a matching verification and refuses to rewrite a verified receipt", async () => {
    const store = new MemoryPublicationStore();
    const published = await publishPending(store, "pub-replay-verify");
    const digest = bodyDigestFromValue(published.receipt.afterValue);
    const request = {
      receiptId: published.receipt.id,
      eventId: published.event.id,
      expectedValueDigest: digest,
      expectedDataRevision: published.receipt.dataRevision,
      verifierPrincipal: "verifier-1",
    };
    const first = await verifyPublication(store, request);
    const second = await verifyPublication(store, request);
    assert.equal(first.outcome, "created");
    assert.equal(second.outcome, "replayed");
    const mismatch = await verifyPublication(store, {
      ...request,
      expectedValueDigest: "e".repeat(64),
    });
    assert.equal(mismatch.outcome, "rejected");
    assert.equal(store.receipts[0]!.verificationState, "verified");
    assert.equal(store.receipts[0]!.verifiedBy, "verifier-1");
  });

  it("serializes concurrent verifications of the same receipt to one verified state", async () => {
    const store = new MemoryPublicationStore();
    const published = await publishPending(store, "pub-verify-race");
    const digest = bodyDigestFromValue(published.receipt.afterValue);
    const request = {
      receiptId: published.receipt.id,
      eventId: published.event.id,
      expectedValueDigest: digest,
      expectedDataRevision: published.receipt.dataRevision,
      verifierPrincipal: "verifier-1",
    };
    const results = await Promise.all(
      Array.from({ length: 8 }, () => verifyPublication(store, request))
    );
    const created = results.filter((row) => row.outcome === "created");
    const replayed = results.filter((row) => row.outcome === "replayed");
    assert.equal(created.length, 1);
    assert.equal(created.length + replayed.length, results.length);
    assert.equal(store.receipts.filter((row) => row.verificationState === "verified").length, 1);
    assert.equal(store.events.length, 1);
  });
});
