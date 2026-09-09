import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryPublicationStore } from "../src/revisions/memory.ts";
import { publishRevision } from "../src/revisions/publish.ts";
import { seedApprovedClaim } from "./publication-fixtures.ts";
import { factFromLedgerRow } from "../src/intelligence/ledger.ts";
import { selectPublicUpdates } from "../src/revisions/public-feed.ts";
import { effectiveChangeType, ledgerState } from "../src/revisions/state.ts";
import type { KnowledgeState } from "../src/knowledge-state.ts";

test("L1/L2: conservative missing state and complete effective transition table", () => {
  assert.deepEqual(ledgerState({}), { knowledgeState: "unknown", assessmentState: "legacy/unverified" });
  assert.deepEqual(ledgerState({ value: { knowledgeState: "present" } }), ledgerState({}));
  const proposed = { changeType: "create" as const, knowledgeState: "present" as const, afterValue: "new" };
  assert.equal(effectiveChangeType(null, proposed), "create");
  for (const knowledgeState of ["unknown", "confirmed_absent"] as KnowledgeState[]) {
    assert.equal(effectiveChangeType({ knowledgeState, value: "old" }, proposed), "create");
  }
  const present = { knowledgeState: "present" as const, value: "old" };
  assert.equal(effectiveChangeType(present, proposed), "update");
  assert.equal(effectiveChangeType(present, { ...proposed, afterValue: "old" }), "update");
  assert.equal(effectiveChangeType(present, { ...proposed, knowledgeState: "confirmed_absent" }), "retract");
  assert.equal(effectiveChangeType(present, { ...proposed, changeType: "retract" }), "retract");
  for (const changeType of ["correction", "rollback"] as const) {
    assert.equal(effectiveChangeType(present, { ...proposed, changeType }), changeType);
  }
  assert.equal(effectiveChangeType(null, { ...proposed, knowledgeState: "unknown" }), "update");
});

async function publish(store: MemoryPublicationStore, id: string, value: unknown) {
  const { proposal, revision } = seedApprovedClaim(store, { proposalId: id, value: { text: value } });
  const result = await publishRevision(store, {
    proposalId: proposal.id, expectedRevisionId: revision.id, expectedBodyDigest: revision.bodyDigest,
    expectedCanonicalDigest: store.canonicalDigest("provider", "local-packages", "hypervisor"),
    idempotencyKey: id, publisherPrincipal: "publisher", methodologyVersion: "test", dataRevision: id,
  });
  assert.equal(result.outcome, "created");
  if (result.outcome !== "created") throw new Error(JSON.stringify(result));
  return result;
}

test("L1: validated claim states survive publication on all ledger objects", async () => {
  const store = new MemoryPublicationStore();
  const result = await publish(store, "typed", "KVM");
  for (const row of [result.receipt, result.event, await store.getCanonicalState("provider", "local-packages", "hypervisor")]) {
    assert.equal(row?.knowledgeState, "present");
    assert.equal(row?.assessmentState, "independently_verified");
  }
});

test("L1: ledger state comes only from typed columns, never payload metadata", () => {
  const row = { receiptId: "r", revisionId: "v", changeType: "create", entityType: "provider", entityId: "p", fieldName: "f", publishedAt: "2026-09-01", verificationState: "verified", afterValue: { knowledgeState: "present", assessmentState: "independently_verified" }, beforeValue: null };
  assert.equal(factFromLedgerRow(row).knowledgeState, "unknown");
  assert.equal(factFromLedgerRow(row).assessmentState, "legacy/unverified");
  const typed = { ...row, knowledgeState: "confirmed_absent" as const, assessmentState: "editorially_reviewed" as const };
  assert.equal(factFromLedgerRow(typed).knowledgeState, "confirmed_absent");
  assert.equal(factFromLedgerRow(typed).assessmentState, "editorially_reviewed");
});

test("L2: second present publication is update, not another verified addition", async () => {
  const store = new MemoryPublicationStore();
  const first = await publish(store, "first", "KVM");
  const second = await publish(store, "second", "Xen");
  assert.equal(first.receipt.changeType, "create");
  assert.equal(second.receipt.changeType, "update");
  assert.equal(second.event.changeType, "update");
});

test("L8: factual selector rejects missing/pending/failed/uncertain receipts and legacy fallback", async () => {
  const store = new MemoryPublicationStore();
  const result = await publish(store, "feed", "KVM");
  assert.deepEqual(selectPublicUpdates([result.event], []), []);
  for (const verificationState of ["pending", "failed", "uncertain", "rolled_back"] as const) {
    assert.deepEqual(selectPublicUpdates([{ ...result.event, verificationState }], []), []);
  }
  const selected = selectPublicUpdates([{ ...result.event, verificationState: "verified" }], []);
  assert.equal(selected.length, 1);
  assert.equal(selected[0]?.verification_state, "verified");
  assert.deepEqual(selectPublicUpdates([], [{ id: 1, kind: "discovered", provider_id: "p", title_id: "legacy", title_en: "legacy", summary_id: null, summary_en: null, href: null, occurred_at: "2026-09-01" }]), []);
});
