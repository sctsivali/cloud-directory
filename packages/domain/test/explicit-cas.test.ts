import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryPublicationStore } from "../src/revisions/memory.ts";
import { publishRevision } from "../src/revisions/publish.ts";
import { publicationRequestDigest } from "../src/revisions/digest.ts";
import type { PublishRequest } from "../src/revisions/types.ts";
import { seedApprovedClaim } from "./publication-fixtures.ts";

function request(store: MemoryPublicationStore, id: string): PublishRequest {
  const { proposal, revision } = seedApprovedClaim(store, { proposalId: id, value: { text: id } });
  return { proposalId: proposal.id, expectedRevisionId: revision.id, expectedBodyDigest: revision.bodyDigest,
    expectedCanonicalDigest: null, idempotencyKey: id, publisherPrincipal: "publisher",
    methodologyVersion: "test", dataRevision: id };
}

test("explicit CAS: omitted or invalid precondition rejects before any store access", async () => {
  const store = new MemoryPublicationStore();
  const valid = request(store, "omitted");
  const { expectedCanonicalDigest: _, ...omitted } = valid;
  const inaccessible = new Proxy(store, { get() { throw new Error("store accessed"); } });
  for (const input of [omitted, ...[undefined, "", " ", 123, {}, false].map(value => ({ ...valid, expectedCanonicalDigest: value }))]) {
    const result = await publishRevision(inaccessible, input as PublishRequest);
    assert.equal(result.outcome, "rejected");
    if (result.outcome === "rejected") assert.equal(result.code, "malformed_payload");
  }
});

test("explicit CAS: late explicit-null contender conflicts; exact digest update succeeds and is request-bound", async () => {
  const store = new MemoryPublicationStore();
  const first = request(store, "first-cas");
  const second = request(store, "second-cas");
  assert.equal((await publishRevision(store, first)).outcome, "created");
  const conflict = await publishRevision(store, second);
  assert.equal(conflict.outcome, "rejected");
  if (conflict.outcome === "rejected") assert.equal(conflict.code, "canonical_state_conflict");
  const digest = store.canonicalDigest("provider", "local-packages", "hypervisor");
  assert.equal(typeof digest, "string");
  const update = { ...second, expectedCanonicalDigest: digest };
  assert.notEqual(publicationRequestDigest(second), publicationRequestDigest(update));
  const result = await publishRevision(store, update);
  assert.equal(result.outcome, "created");
  if (result.outcome === "created") assert.equal(result.receipt.changeType, "update");
  assert.equal((await publishRevision(store, update)).outcome, "replayed");
  const altered = await publishRevision(store, second);
  assert.equal(altered.outcome, "rejected");
  if (altered.outcome === "rejected") assert.equal(altered.code, "idempotency_conflict");
  assert.equal(store.receipts.length, 2);
});
