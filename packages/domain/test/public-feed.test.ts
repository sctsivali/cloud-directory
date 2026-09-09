import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  selectPublicUpdates,
  toApiUpdate,
  toPublicUpdate,
  type LegacyDirectoryUpdate,
} from "../src/revisions/public-feed.ts";
import type { ChangeEvent } from "../src/revisions/types.ts";

const event: ChangeEvent = {
  id: "evt-1",
  receiptId: "rcpt-1",
  revisionId: "rev-1",
  proposalId: "prop-1",
  changeType: "update",
  entityType: "provider",
  entityId: "local-packages",
  fieldName: "hypervisor",
  oldValue: { text: "Xen" },
  newValue: { text: "KVM" },
  valueSensitivity: "public",
  sourceId: "src-1",
  evidenceSnapshotIds: ["snap-1"],
  detectedAt: "2026-09-01T00:00:00.000Z",
  observedAt: "2026-09-02T00:00:00.000Z",
  reviewedAt: "2026-09-03T00:00:00.000Z",
  publishedAt: "2026-09-04T00:00:00.000Z",
  correctionOfEventId: null,
  titleId: "Hypervisor berubah",
  titleEn: "Hypervisor changed",
  summaryId: "Dari Xen ke KVM",
  summaryEn: "From Xen to KVM",
  providerId: "local-packages",
  href: "/provider/local-packages",
};

const fallback: LegacyDirectoryUpdate = {
  id: 7,
  kind: "updated",
  provider_id: "legacy-local",
  title_id: "Legacy berubah",
  title_en: "Legacy changed",
  summary_id: "Ringkasan lama",
  summary_en: "Old summary",
  href: "/provider/legacy-local",
  occurred_at: "2026-08-01T00:00:00.000Z",
};

describe("public change-event feed", () => {
  it("maps published events to safe public updates", () => {
    const update = toPublicUpdate(event);
    assert.equal(update.id, "evt-1");
    assert.equal(update.kind, "updated");
    assert.equal(update.change_type, "update");
    assert.equal(update.entity_type, "provider");
    assert.equal(update.field, "hypervisor");
    assert.deepEqual(update.old_value, { text: "Xen" });
    assert.deepEqual(update.new_value, { text: "KVM" });
    assert.equal(update.value_sensitivity, "public");
    assert.equal(update.source, "src-1");
    assert.deepEqual(update.evidence_snapshot_ids, ["snap-1"]);
    assert.equal(update.detected_at, event.detectedAt);
    assert.equal(update.observed_at, event.observedAt);
    assert.equal(update.reviewed_at, event.reviewedAt);
    assert.equal(update.published_at, event.publishedAt);
    assert.equal(update.revision_id, "rev-1");
    assert.equal(update.revision_href, "/revisions/rev-1");
    assert.equal(update.correction_of, null);
    assert.equal(update.occurred_at, event.publishedAt);
  });

  it("redacts unsafe old and new values", () => {
    const redacted = toPublicUpdate({
      ...event,
      valueSensitivity: "redacted",
      oldValue: { secret: "hidden" },
      newValue: { secret: "still-hidden" },
    });
    assert.equal(redacted.old_value, null);
    assert.equal(redacted.new_value, null);
    assert.equal(redacted.value_sensitivity, "redacted");
  });

  it("prefers change events and falls back to directory_updates when none exist", () => {
    const fromEvents = selectPublicUpdates([event], [fallback]);
    assert.equal(fromEvents.length, 1);
    assert.equal(fromEvents[0]?.id, "evt-1");
    assert.equal(fromEvents[0]?.revision_id, "rev-1");

    const fromFallback = selectPublicUpdates([], [fallback]);
    assert.equal(fromFallback.length, 1);
    assert.equal(fromFallback[0]?.id, 7);
    assert.equal(fromFallback[0]?.title_en, "Legacy changed");
    assert.equal(fromFallback[0]?.revision_id, null);
    assert.equal(fromFallback[0]?.change_type, "updated");
  });

  it("keeps API and view fields in parity for the same event", () => {
    const view = toPublicUpdate(event);
    const api = toApiUpdate(view);
    assert.equal(api.id, view.id);
    assert.equal(api.change_type, view.change_type);
    assert.deepEqual(api.old_value, view.old_value);
    assert.deepEqual(api.new_value, view.new_value);
    assert.equal(api.source, view.source);
    assert.deepEqual(api.evidence_snapshot_ids, view.evidence_snapshot_ids);
    assert.equal(api.detected_at, view.detected_at);
    assert.equal(api.observed_at, view.observed_at);
    assert.equal(api.reviewed_at, view.reviewed_at);
    assert.equal(api.published_at, view.published_at);
    assert.equal(api.revision_id, view.revision_id);
    assert.equal(api.revision_href, view.revision_href);
    assert.equal(api.correction_of, view.correction_of);
    assert.equal(api.occurred_at, view.occurred_at);
  });
});
