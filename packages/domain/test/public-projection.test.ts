import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CURRENT_METHODOLOGY } from "../src/scoring/methodology.ts";
import { MemoryPublicationStore } from "../src/revisions/memory.ts";
import { publishRevision } from "../src/revisions/publish.ts";
import { verifyPublication } from "../src/revisions/verify.ts";
import { bodyDigestFromValue } from "../src/revisions/digest.ts";
import { toApiUpdate, toPublicUpdate } from "../src/revisions/public-feed.ts";
import {
  projectPublicTimelineDocument,
  projectVerifiedPublicReadModel,
} from "../src/revisions/public-projection.ts";
import { buildProviderTimeline, buildCountryTimeline } from "../src/intelligence/timeline.ts";
import { factsFromLedgerRows } from "../src/intelligence/ledger.ts";
import { publicTrendView, buildTrendReport } from "../src/intelligence/trends.ts";
import { seedApprovedProposal } from "./publication-fixtures.ts";

const SECRET = "redacted-secret-value-NEVER-PUBLIC";

function leak(value: unknown): boolean {
  return JSON.stringify(value).includes(SECRET);
}

describe("allowlisted public projection", () => {
  it("redacts receipt values on updates, timelines, country/provider, and the read model", async () => {
    const store = new MemoryPublicationStore();
    const seeded = seedApprovedProposal(store, {
      proposalId: "prop-secret",
      toolName: "directory.propose_claim",
      body: {
        subjectType: "provider",
        subjectId: "local-packages",
        claimType: "token",
        value: { token: SECRET },
        knowledgeState: "present",
        assessmentState: "independently_verified",
        observedAt: "2026-09-01T00:00:00.000Z",
        snapshotId: "snap-secret",
      },
    });
    const published = await publishRevision(store, {
      proposalId: seeded.proposal.id,
      expectedRevisionId: seeded.revision.id,
      expectedBodyDigest: seeded.proposal.bodyDigest,
      idempotencyKey: "pub-secret",
      methodologyVersion: CURRENT_METHODOLOGY.id,
      dataRevision: "drv-secret",
      publisherPrincipal: "publisher-1",
      expectedCanonicalDigest: null,
    });
    assert.equal(published.outcome, "created");
    if (published.outcome !== "created") return;
    assert.equal(published.event.valueSensitivity, "redacted");
    assert.deepEqual(published.receipt.afterValue, { token: SECRET });

    const verified = await verifyPublication(store, {
      receiptId: published.receipt.id,
      eventId: published.event.id,
      expectedValueDigest: bodyDigestFromValue(published.receipt.afterValue),
      expectedDataRevision: published.receipt.dataRevision,
      verifierPrincipal: "verifier-1",
    });
    assert.equal(verified.outcome, "created");

    const update = toPublicUpdate(published.event);
    assert.equal(update.value_sensitivity, "redacted");
    assert.equal(update.old_value, null);
    assert.equal(update.new_value, null);
    assert.equal(leak(update), false);
    assert.equal(leak(toApiUpdate(update)), false);

    const facts = factsFromLedgerRows(
      store.receipts.map((receipt) => {
        const event = store.events.find((row) => row.receiptId === receipt.id)!;
        return {
          receiptId: receipt.id,
          revisionId: receipt.revisionId,
          changeType: receipt.changeType,
          entityType: receipt.entityId ? receipt.entityType : "provider",
          entityId: receipt.entityId,
          fieldName: receipt.fieldName,
          providerId: event.providerId,
          observedAt: event.observedAt ?? receipt.publishedAt,
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
    );
    const window = { start: "2026-01-01T00:00:00.000Z", end: "2026-12-01T00:00:00.000Z" };
    const providerTimeline = projectPublicTimelineDocument(
      buildProviderTimeline({ facts, window, providerId: "local-packages", dataRevision: "drv-secret" })
    );
    const countryTimeline = projectPublicTimelineDocument(
      buildCountryTimeline({ facts, window, countryCode: "ID", dataRevision: "drv-secret" })
    );
    assert.equal(providerTimeline.events.length > 0, true);
    assert.equal(providerTimeline.events.every((row) => row.valueSensitivity === "redacted"), true);
    assert.equal(providerTimeline.events.every((row) => row.afterValue == null && row.beforeValue == null), true);
    assert.equal(leak(providerTimeline), false);
    assert.equal(leak(countryTimeline), false);

    const trends = publicTrendView(buildTrendReport({ facts, window, providerId: "local-packages" }));
    assert.equal(leak(trends), false);

    const model = projectVerifiedPublicReadModel(facts);
    assert.equal(model.claims.length, 1);
    assert.equal(model.claims[0]?.valueSensitivity, "redacted");
    assert.equal(model.claims[0]?.value, null);
    assert.equal(leak(model), false);
  });
});
