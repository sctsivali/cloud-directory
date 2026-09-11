import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_SUBMISSION_REASON_CODES,
  SUBMISSION_OUTCOMES,
  boundReasonCodes,
  isAmbiguousTerminal,
  reasonCodesFromVerifierReasons,
  requireSubmissionIdentity,
  resolveCollectionTaskStatus,
  shouldAutoRetrySubmission,
  submissionIdentityMatches,
} from "../src/collection-submissions.ts";

describe("L11 durable collection submission outcomes", () => {
  it("enumerates created, replayed, rejected, and ambiguous outcomes", () => {
    assert.deepEqual([...SUBMISSION_OUTCOMES], ["created", "replayed", "rejected", "ambiguous"]);
  });

  it("treats ambiguous as terminal and never auto-retried", () => {
    assert.equal(isAmbiguousTerminal("ambiguous"), true);
    assert.equal(isAmbiguousTerminal("rejected"), false);
    assert.equal(shouldAutoRetrySubmission(undefined), true);
    assert.equal(shouldAutoRetrySubmission({ outcome: "ambiguous" }), false);
    assert.equal(shouldAutoRetrySubmission({ outcome: "created" }), false);
    assert.equal(shouldAutoRetrySubmission({ outcome: "replayed" }), false);
    assert.equal(shouldAutoRetrySubmission({ outcome: "rejected" }), false);
  });

  it("gates proposed on every required submission being created or replayed", () => {
    assert.equal(
      resolveCollectionTaskStatus(
        [
          { idempotencyKey: "a", outcome: "created" },
          { idempotencyKey: "b", outcome: "replayed" },
        ],
        2
      ),
      "proposed"
    );
    assert.equal(resolveCollectionTaskStatus([], 0), "failed");
    assert.equal(resolveCollectionTaskStatus([{ idempotencyKey: "a", outcome: "created" }], 2), "failed");
  });

  it("maps rejected required submissions to failed, not proposed", () => {
    assert.equal(
      resolveCollectionTaskStatus(
        [
          { idempotencyKey: "a", outcome: "created" },
          { idempotencyKey: "b", outcome: "rejected" },
        ],
        2
      ),
      "failed"
    );
  });

  it("maps ambiguous required submissions to needs_review/ambiguous, not proposed", () => {
    const status = resolveCollectionTaskStatus(
      [
        { idempotencyKey: "a", outcome: "created" },
        { idempotencyKey: "b", outcome: "ambiguous" },
      ],
      2
    );
    assert.ok(status === "needs_review" || status === "ambiguous");
    assert.notEqual(status, "proposed");
    assert.notEqual(status, "failed");
  });

  it("prefers manual-reconcile ambiguous over rejected when both exist", () => {
    const status = resolveCollectionTaskStatus(
      [
        { idempotencyKey: "a", outcome: "rejected" },
        { idempotencyKey: "b", outcome: "ambiguous" },
      ],
      2
    );
    assert.ok(status === "needs_review" || status === "ambiguous");
    assert.notEqual(status, "proposed");
  });

  it("bounds reason codes by allowlist, pattern, and cardinality", () => {
    assert.deepEqual(boundReasonCodes(["excerpt_missing", "stale_evidence"]), [
      "excerpt_missing",
      "stale_evidence",
    ]);
    assert.throws(() => boundReasonCodes(["NOT A CODE"]));
    assert.throws(() => boundReasonCodes(["unknown_reason_code"]));
    assert.throws(() =>
      boundReasonCodes(Array.from({ length: MAX_SUBMISSION_REASON_CODES + 1 }, () => "mcp_rejected"))
    );
  });

  it("maps verifier reasons onto bounded codes for the proposal payload and outcome record", () => {
    const codes = reasonCodesFromVerifierReasons([
      "exact excerpt missing from snapshot",
      "ai disagreement is conflicting/needs_review, not majority truth",
      "mystery reason that must still bound",
    ]);
    assert.deepEqual(codes, ["excerpt_missing", "ai_disagreement", "mcp_rejected"]);
    assert.doesNotThrow(() => boundReasonCodes(codes));
  });

  it("requires exact task, tool, key, and digest identity", () => {
    const existing = {
      taskId: "task-a",
      toolName: "directory.propose_claim",
      idempotencyKey: "k-1",
      requestDigest: "a".repeat(64),
    };
    assert.equal(submissionIdentityMatches(existing, existing), true);
    assert.throws(() =>
      requireSubmissionIdentity(existing, { ...existing, taskId: "task-b" })
    );
    assert.throws(() =>
      requireSubmissionIdentity(existing, { ...existing, toolName: "directory.propose_facility" })
    );
    assert.throws(() =>
      requireSubmissionIdentity(existing, { ...existing, requestDigest: "b".repeat(64) })
    );
    assert.equal(requireSubmissionIdentity(null, existing), null);
  });
});
