import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CURRENT_METHODOLOGY } from "../src/scoring/methodology.ts";
import { MemoryPublicationStore } from "../src/revisions/memory.ts";
import { publishRevision, rollbackPublication } from "../src/revisions/publish.ts";
import { PUBLICATION_ERROR } from "../src/revisions/types.ts";
import { seedApprovedClaim } from "./publication-fixtures.ts";

describe("publication rollback", () => {
  it("creates a new approved revision and event without deleting history", async () => {
    const store = new MemoryPublicationStore();
    const original = seedApprovedClaim(store);
    const published = await publishRevision(store, {
      proposalId: original.proposal.id,
      expectedRevisionId: original.revision.id,
      expectedBodyDigest: original.proposal.bodyDigest,
      idempotencyKey: "pub-orig",
      methodologyVersion: CURRENT_METHODOLOGY.id,
      dataRevision: "drv-1",
      publisherPrincipal: "publisher-1",
      expectedCanonicalDigest: null,
    });
    assert.equal(published.outcome, "created");
    if (published.outcome !== "created") return;

    const rollbackSeed = seedApprovedClaim(store, {
      proposalId: "prop-rollback",
      actorId: "worker-b",
      reviewerId: "editor-2",
      value: { text: "KVM", rollbackOfReceiptId: published.receipt.id },
    });

    const rolled = await rollbackPublication(store, {
      originalReceiptId: published.receipt.id,
      proposalId: rollbackSeed.proposal.id,
      expectedRevisionId: rollbackSeed.revision.id,
      expectedBodyDigest: rollbackSeed.proposal.bodyDigest,
      idempotencyKey: "pub-rollback",
      methodologyVersion: CURRENT_METHODOLOGY.id,
      dataRevision: "drv-2",
      publisherPrincipal: "publisher-1",
      expectedCanonicalDigest: store.canonicalDigest(
        published.receipt.entityType,
        published.receipt.entityId,
        published.receipt.fieldName
      ),
    });
    assert.equal(rolled.outcome, "created");
    if (rolled.outcome !== "created") return;
    assert.equal(rolled.event.changeType, "rollback");
    assert.equal(rolled.event.correctionOfEventId, published.event.id);
    assert.equal(rolled.receipt.supersedesReceiptId, published.receipt.id);
    assert.deepEqual(rolled.receipt.afterValue, published.receipt.beforeValue);
    assert.deepEqual(rolled.receipt.beforeValue, published.receipt.afterValue);
    assert.equal(store.receipts.length, 2);
    assert.equal(store.events.length, 2);
    assert.ok(store.receipts.some((row) => row.id === published.receipt.id));
    assert.ok(store.events.some((row) => row.id === published.event.id));
    assert.equal(store.canonicalValue("provider", "local-packages", "hypervisor"), published.receipt.beforeValue);
  });

  it("rejects cross-entity and cross-field rollback of an original receipt", async () => {
    const store = new MemoryPublicationStore();
    const original = seedApprovedClaim(store);
    const published = await publishRevision(store, {
      proposalId: original.proposal.id,
      expectedRevisionId: original.revision.id,
      expectedBodyDigest: original.proposal.bodyDigest,
      idempotencyKey: "pub-orig-x",
      methodologyVersion: CURRENT_METHODOLOGY.id,
      dataRevision: "drv-1",
      publisherPrincipal: "publisher-1",
      expectedCanonicalDigest: null,
    });
    assert.equal(published.outcome, "created");
    if (published.outcome !== "created") return;

    const otherEntity = seedApprovedClaim(store, {
      proposalId: "prop-other-entity",
      actorId: "worker-b",
      reviewerId: "editor-2",
      subjectId: "other-provider",
      value: { text: "KVM" },
    });
    const crossEntity = await rollbackPublication(store, {
      originalReceiptId: published.receipt.id,
      proposalId: otherEntity.proposal.id,
      expectedRevisionId: otherEntity.revision.id,
      expectedBodyDigest: otherEntity.proposal.bodyDigest,
      expectedCanonicalDigest: null,
      idempotencyKey: "pub-cross-entity",
      methodologyVersion: CURRENT_METHODOLOGY.id,
      dataRevision: "drv-2",
      publisherPrincipal: "publisher-1",
    });
    assert.equal(crossEntity.outcome, "rejected");
    if (crossEntity.outcome === "rejected") {
      assert.equal(crossEntity.code, PUBLICATION_ERROR.subjectMismatch);
    }

    const otherField = seedApprovedClaim(store, {
      proposalId: "prop-other-field",
      actorId: "worker-c",
      reviewerId: "editor-3",
      claimType: "cpu",
      value: { text: "KVM" },
    });
    const crossField = await rollbackPublication(store, {
      originalReceiptId: published.receipt.id,
      proposalId: otherField.proposal.id,
      expectedRevisionId: otherField.revision.id,
      expectedBodyDigest: otherField.proposal.bodyDigest,
      expectedCanonicalDigest: null,
      idempotencyKey: "pub-cross-field",
      methodologyVersion: CURRENT_METHODOLOGY.id,
      dataRevision: "drv-3",
      publisherPrincipal: "publisher-1",
    });
    assert.equal(crossField.outcome, "rejected");
    if (crossField.outcome === "rejected") {
      assert.equal(crossField.code, PUBLICATION_ERROR.subjectMismatch);
    }
    assert.equal(store.receipts.length, 1);
    assert.deepEqual(store.canonicalValue("provider", "local-packages", "hypervisor"), { text: "KVM" });
    assert.equal(store.canonicalValue("provider", "other-provider", "hypervisor"), null);
    assert.equal(store.canonicalValue("provider", "local-packages", "cpu"), null);
  });

  it("rejects a stale rollback after canonical state has moved on and after supersession", async () => {
    const store = new MemoryPublicationStore();
    const first = seedApprovedClaim(store, { value: { text: "KVM" } });
    const published = await publishRevision(store, {
      proposalId: first.proposal.id,
      expectedRevisionId: first.revision.id,
      expectedBodyDigest: first.proposal.bodyDigest,
      idempotencyKey: "pub-stale-src",
      methodologyVersion: CURRENT_METHODOLOGY.id,
      dataRevision: "drv-1",
      publisherPrincipal: "publisher-1",
      expectedCanonicalDigest: null,
    });
    assert.equal(published.outcome, "created");
    if (published.outcome !== "created") return;

    const successor = seedApprovedClaim(store, {
      proposalId: "prop-successor",
      actorId: "worker-b",
      reviewerId: "editor-2",
      value: { text: "Xen" },
    });
    const next = await publishRevision(store, {
      proposalId: successor.proposal.id,
      expectedRevisionId: successor.revision.id,
      expectedBodyDigest: successor.proposal.bodyDigest,
      idempotencyKey: "pub-successor",
      methodologyVersion: CURRENT_METHODOLOGY.id,
      dataRevision: "drv-2",
      publisherPrincipal: "publisher-1",
      expectedCanonicalDigest: store.canonicalDigest("provider", "local-packages", "hypervisor"),
    });
    assert.equal(next.outcome, "created");
    if (next.outcome !== "created") return;

    const staleSeed = seedApprovedClaim(store, {
      proposalId: "prop-stale-roll",
      actorId: "worker-c",
      reviewerId: "editor-3",
      value: { text: "KVM" },
    });
    const stale = await rollbackPublication(store, {
      originalReceiptId: published.receipt.id,
      proposalId: staleSeed.proposal.id,
      expectedRevisionId: staleSeed.revision.id,
      expectedBodyDigest: staleSeed.proposal.bodyDigest,
      idempotencyKey: "pub-stale-roll",
      methodologyVersion: CURRENT_METHODOLOGY.id,
      dataRevision: "drv-3",
      publisherPrincipal: "publisher-1",
      expectedCanonicalDigest: store.canonicalDigest("provider", "local-packages", "hypervisor"),
    });
    assert.equal(stale.outcome, "rejected");
    if (stale.outcome === "rejected") {
      assert.equal(stale.code, PUBLICATION_ERROR.staleRollback);
    }
    assert.deepEqual(store.canonicalValue("provider", "local-packages", "hypervisor"), { text: "Xen" });

    const rollbackSeed = seedApprovedClaim(store, {
      proposalId: "prop-roll-ok",
      actorId: "worker-d",
      reviewerId: "editor-4",
      value: { text: "Xen" },
    });
    const rolled = await rollbackPublication(store, {
      originalReceiptId: next.outcome === "created" ? next.receipt.id : published.receipt.id,
      proposalId: rollbackSeed.proposal.id,
      expectedRevisionId: rollbackSeed.revision.id,
      expectedBodyDigest: rollbackSeed.proposal.bodyDigest,
      idempotencyKey: "pub-roll-ok",
      methodologyVersion: CURRENT_METHODOLOGY.id,
      dataRevision: "drv-4",
      publisherPrincipal: "publisher-1",
      expectedCanonicalDigest: store.canonicalDigest("provider", "local-packages", "hypervisor"),
    });
    assert.equal(rolled.outcome, "created");
    if (rolled.outcome !== "created") return;

    const again = seedApprovedClaim(store, {
      proposalId: "prop-roll-again",
      actorId: "worker-e",
      reviewerId: "editor-5",
      value: { text: "Xen" },
    });
    const duplicate = await rollbackPublication(store, {
      originalReceiptId: next.receipt.id,
      proposalId: again.proposal.id,
      expectedRevisionId: again.revision.id,
      expectedBodyDigest: again.proposal.bodyDigest,
      idempotencyKey: "pub-roll-again",
      methodologyVersion: CURRENT_METHODOLOGY.id,
      dataRevision: "drv-5",
      publisherPrincipal: "publisher-1",
      expectedCanonicalDigest: store.canonicalDigest("provider", "local-packages", "hypervisor"),
    });
    assert.equal(duplicate.outcome, "rejected");
    if (duplicate.outcome === "rejected") {
      assert.ok(
        duplicate.code === PUBLICATION_ERROR.supersessionInvalid ||
          duplicate.code === PUBLICATION_ERROR.staleRollback
      );
    }
    assert.equal(store.receipts.filter((row) => row.changeType === "rollback").length, 1);
  });
});
