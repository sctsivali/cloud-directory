import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CURRENT_METHODOLOGY } from "../src/scoring/methodology.ts";
import {
  deriveSubject,
  stableFacilityId,
  stableLocationId,
  stableOfferingId,
  stableTechnologyId,
} from "../src/revisions/subject.ts";
import { MemoryPublicationStore } from "../src/revisions/memory.ts";
import { publishRevision } from "../src/revisions/publish.ts";
import { verifyPublication } from "../src/revisions/verify.ts";
import { bodyDigestFromValue } from "../src/revisions/digest.ts";
import { projectVerifiedPublicReadModel } from "../src/revisions/public-projection.ts";
import { factsFromLedgerRows } from "../src/intelligence/ledger.ts";
import { seedApprovedProposal } from "./publication-fixtures.ts";

function snapshot(toolName: string, body: Record<string, unknown>) {
  return {
    id: "prop-x",
    toolName,
    actorId: "worker-a",
    idempotencyKey: "k",
    body,
    bodyDigest: "a".repeat(64),
    status: "approved",
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z",
  };
}

const revision = {
  id: "rev-x",
  proposalId: "prop-x",
  revisionOrdinal: 1,
  body: {},
  bodyDigest: "a".repeat(64),
  actorId: "worker-a",
  createdAt: "2026-09-09T00:00:00.000Z",
};

describe("typed publication adapters", () => {
  it("keeps claims on the subject/field key and does not collide offerings under a provider", () => {
    const claim = deriveSubject(
      snapshot("directory.propose_claim", {
        subjectType: "provider",
        subjectId: "local-packages",
        claimType: "hypervisor",
        value: { text: "KVM" },
        snapshotId: "snap-1",
      }),
      revision,
      null
    );
    assert.equal(claim.entityType, "provider");
    assert.equal(claim.entityId, "local-packages");
    assert.equal(claim.fieldName, "hypervisor");
    assert.equal(claim.providerId, "local-packages");
    assert.deepEqual(claim.afterValue, { text: "KVM" });

    const a = deriveSubject(
      snapshot("directory.propose_offering", {
        providerId: "local-packages",
        serviceId: "svc-compute",
        name: "Small ID",
      }),
      revision,
      null
    );
    const b = deriveSubject(
      snapshot("directory.propose_offering", {
        providerId: "local-packages",
        serviceId: "svc-compute",
        name: "Medium ID",
      }),
      revision,
      null
    );
    assert.equal(a.entityType, "offering");
    assert.equal(b.entityType, "offering");
    assert.equal(a.fieldName, "offering");
    assert.notEqual(a.entityId, "local-packages");
    assert.notEqual(b.entityId, "local-packages");
    assert.notEqual(a.entityId, b.entityId);
    assert.equal(a.providerId, "local-packages");
    assert.equal(a.entityId, stableOfferingId("local-packages", "svc-compute", "Small ID"));
  });

  it("does not map price, location, facility, or technology onto the provider entity", () => {
    const price = deriveSubject(
      snapshot("directory.propose_price_observation", {
        offeringId: "off-a1",
        amount: 12,
        currency: "USD",
        billingUnit: "month",
      }),
      revision,
      null
    );
    assert.equal(price.entityType, "price");
    assert.equal(price.entityId, "off-a1");
    assert.equal(price.fieldName, "price");
    assert.equal(price.providerId, null);

    const location = deriveSubject(
      snapshot("directory.propose_location", {
        city: "Jakarta",
        country: "ID",
      }),
      revision,
      null
    );
    assert.equal(location.entityType, "location");
    assert.equal(location.entityId, stableLocationId("ID", "Jakarta"));
    assert.equal(location.fieldName, "location");
    assert.equal(location.providerId, null);
    assert.equal((location.afterValue as { country?: string }).country, "ID");

    const facility = deriveSubject(
      snapshot("directory.propose_facility", {
        name: "Jakarta Hall",
        locationId: "loc-1",
        operator: "op-nusantara",
      }),
      revision,
      null
    );
    assert.equal(facility.entityType, "facility");
    assert.equal(facility.entityId, stableFacilityId("Jakarta Hall", "loc-1"));
    assert.equal(facility.fieldName, "facility");
    assert.equal(facility.providerId, null);

    const scoped = deriveSubject(
      snapshot("directory.propose_technology_deployment", {
        technologyId: "tech-kvm",
        scope: "offering",
        scopeId: "off-a1",
      }),
      revision,
      null
    );
    assert.equal(scoped.entityType, "technology");
    assert.equal(scoped.entityId, stableTechnologyId("tech-kvm", "offering", "off-a1"));
    assert.equal(scoped.fieldName, "technology");
    assert.equal(scoped.providerId, null);

    const providerScoped = deriveSubject(
      snapshot("directory.propose_technology_deployment", {
        technologyId: "tech-kvm",
        scope: "provider",
        scopeId: "local-packages",
      }),
      revision,
      null
    );
    assert.equal(providerScoped.entityType, "technology");
    assert.equal(providerScoped.providerId, "local-packages");
  });

  it("binds retractions to the original claim canonical key", () => {
    const retraction = deriveSubject(
      snapshot("directory.propose_retraction", {
        claimId: "provider:local-packages:hypervisor",
        reason: "superseded",
      }),
      revision,
      null
    );
    assert.equal(retraction.entityType, "provider");
    assert.equal(retraction.entityId, "local-packages");
    assert.equal(retraction.fieldName, "hypervisor");
    assert.equal(retraction.changeType, "retract");
    assert.equal(retraction.afterValue, null);
  });
});

describe("verified ledger public read model", () => {
  it("projects each propose tool after publish and verify, including retraction", async () => {
    const store = new MemoryPublicationStore();
    const tools = [
      {
        toolName: "directory.propose_claim",
        body: {
          subjectType: "provider",
          subjectId: "local-packages",
          claimType: "hypervisor",
          value: { text: "KVM" },
          knowledgeState: "present",
          assessmentState: "independently_verified",
          observedAt: "2026-09-01T00:00:00.000Z",
          snapshotId: "snap-1",
        },
        expect: { entityType: "provider", entityId: "local-packages", fieldName: "hypervisor" },
      },
      {
        toolName: "directory.propose_offering",
        body: {
          providerId: "local-packages",
          serviceId: "svc-compute",
          name: "Small ID",
        },
        expect: { entityType: "offering", fieldName: "offering" },
      },
      {
        toolName: "directory.propose_price_observation",
        body: {
          offeringId: "off-a1",
          amount: 11,
          currency: "USD",
          billingUnit: "month",
        },
        expect: { entityType: "price", entityId: "off-a1", fieldName: "price" },
      },
      {
        toolName: "directory.propose_location",
        body: { city: "Jakarta", country: "ID" },
        expect: { entityType: "location", fieldName: "location" },
      },
      {
        toolName: "directory.propose_facility",
        body: { name: "Jakarta Hall", locationId: "loc-1" },
        expect: { entityType: "facility", fieldName: "facility" },
      },
      {
        toolName: "directory.propose_technology_deployment",
        body: { technologyId: "tech-kvm", scope: "offering", scopeId: "off-a1" },
        expect: { entityType: "technology", fieldName: "technology" },
      },
    ] as const;

    const offeringIds = new Set<string>();
    for (const [index, tool] of tools.entries()) {
      const seeded = seedApprovedProposal(store, {
        proposalId: `prop-${index}`,
        toolName: tool.toolName,
        body: tool.body,
      });
      const published = await publishRevision(store, {
        proposalId: seeded.proposal.id,
        expectedRevisionId: seeded.revision.id,
        expectedBodyDigest: seeded.proposal.bodyDigest,
        idempotencyKey: `pub-${index}`,
        methodologyVersion: CURRENT_METHODOLOGY.id,
        dataRevision: `drv-${index}`,
        publisherPrincipal: "publisher-1",
        expectedCanonicalDigest: null,
      });
      assert.equal(published.outcome, "created", tool.toolName);
      if (published.outcome !== "created") continue;
      assert.equal(published.receipt.entityType, tool.expect.entityType, tool.toolName);
      assert.equal(published.receipt.fieldName, tool.expect.fieldName, tool.toolName);
      if ("entityId" in tool.expect) {
        assert.equal(published.receipt.entityId, tool.expect.entityId, tool.toolName);
      }
      if (tool.toolName === "directory.propose_offering") {
        offeringIds.add(published.receipt.entityId);
        assert.notEqual(published.receipt.entityId, "local-packages");
      }
      const verified = await verifyPublication(store, {
        receiptId: published.receipt.id,
        eventId: published.event.id,
        expectedValueDigest: bodyDigestFromValue(published.receipt.afterValue),
        expectedDataRevision: published.receipt.dataRevision,
        verifierPrincipal: "verifier-1",
      });
      assert.equal(verified.outcome, "created", tool.toolName);
    }

    const secondOffering = seedApprovedProposal(store, {
      proposalId: "prop-off-2",
      toolName: "directory.propose_offering",
      body: { providerId: "local-packages", serviceId: "svc-compute", name: "Medium ID" },
    });
    const secondPublished = await publishRevision(store, {
      proposalId: secondOffering.proposal.id,
      expectedRevisionId: secondOffering.revision.id,
      expectedBodyDigest: secondOffering.proposal.bodyDigest,
      idempotencyKey: "pub-off-2",
      methodologyVersion: CURRENT_METHODOLOGY.id,
      dataRevision: "drv-off-2",
      publisherPrincipal: "publisher-1",
      expectedCanonicalDigest: null,
    });
    assert.equal(secondPublished.outcome, "created");
    if (secondPublished.outcome === "created") {
      offeringIds.add(secondPublished.receipt.entityId);
      await verifyPublication(store, {
        receiptId: secondPublished.receipt.id,
        eventId: secondPublished.event.id,
        expectedValueDigest: bodyDigestFromValue(secondPublished.receipt.afterValue),
        expectedDataRevision: secondPublished.receipt.dataRevision,
        verifierPrincipal: "verifier-1",
      });
    }
    assert.equal(offeringIds.size, 2);

    const retract = seedApprovedProposal(store, {
      proposalId: "prop-retract",
      toolName: "directory.propose_retraction",
      body: { claimId: "provider:local-packages:hypervisor", reason: "replaced" },
    });
    const retracted = await publishRevision(store, {
      proposalId: retract.proposal.id,
      expectedRevisionId: retract.revision.id,
      expectedBodyDigest: retract.proposal.bodyDigest,
      idempotencyKey: "pub-retract",
      methodologyVersion: CURRENT_METHODOLOGY.id,
      dataRevision: "drv-retract",
      publisherPrincipal: "publisher-1",
    });
    assert.equal(retracted.outcome, "created");
    if (retracted.outcome === "created") {
      assert.equal(retracted.receipt.changeType, "retract");
      assert.equal(retracted.receipt.entityType, "provider");
      assert.equal(retracted.receipt.entityId, "local-packages");
      assert.equal(retracted.receipt.fieldName, "hypervisor");
      await verifyPublication(store, {
        receiptId: retracted.receipt.id,
        eventId: retracted.event.id,
        expectedValueDigest: bodyDigestFromValue(retracted.receipt.afterValue),
        expectedDataRevision: retracted.receipt.dataRevision,
        verifierPrincipal: "verifier-1",
      });
    }

    const model = projectVerifiedPublicReadModel(
      factsFromLedgerRows(
        store.receipts.map((receipt) => {
          const event = store.events.find((row) => row.receiptId === receipt.id)!;
          return {
            receiptId: receipt.id,
            revisionId: receipt.revisionId,
            changeType: receipt.changeType,
            entityType: receipt.entityType,
            entityId: receipt.entityId,
            fieldName: receipt.fieldName,
            providerId: event.providerId,
            observedAt: event.observedAt,
            publishedAt: receipt.publishedAt,
            verificationState: receipt.verificationState,
            afterValue: receipt.afterValue,
            beforeValue: receipt.beforeValue,
            methodologyVersion: receipt.methodologyVersion,
            dataRevision: receipt.dataRevision,
            supersedesReceiptId: receipt.supersedesReceiptId,
            valueSensitivity: event.valueSensitivity,
          };
        })
      )
    );
    assert.equal(model.claims.some((row) => row.fieldName === "hypervisor" && row.changeType === "retract"), true);
    assert.equal(model.offerings.length, 2);
    assert.equal(model.prices.length, 1);
    assert.equal(model.locations.length, 1);
    assert.equal(model.facilities.length, 1);
    assert.equal(model.technologies.length, 1);
    assert.equal(model.offerings.every((row) => row.entityType === "offering"), true);
    assert.equal(model.facilities.every((row) => row.entityType === "facility"), true);
    assert.equal(model.locations.every((row) => row.entityType === "location"), true);
    assert.equal(model.technologies.every((row) => row.entityType === "technology"), true);
  });
});
