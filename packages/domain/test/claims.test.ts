import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ASSESSMENT_STATES,
  KNOWLEDGE_STATES,
  unknownIsConfirmedAbsence,
  unknownIsFalse,
} from "../src/knowledge-state.ts";
import {
  assignObservationTime,
  canPresentAsFreshlyVerified,
  excerptExistsInSnapshot,
  resolveKnowledgeState,
  sourceSupportsClaim,
  validateClaim,
  validateQuotedExcerpt,
} from "../src/claim-validation.ts";

const snapshot = {
  id: "snap-1",
  body: "Our Jakarta region offers KVM virtual machines. GPU is not available.",
  fetchedAt: "2026-01-01T00:00:00Z",
  contentSha256: "abc",
};

describe("knowledge and assessment states", () => {
  it("keeps unknown distinct from false and from confirmed absence", () => {
    assert.deepEqual(KNOWLEDGE_STATES, [
      "present",
      "confirmed_absent",
      "unknown",
      "not_applicable",
      "conflicting",
    ]);
    assert.ok(ASSESSMENT_STATES.includes("independently_verified"));
    assert.ok(ASSESSMENT_STATES.includes("legacy/unverified"));
    assert.equal(unknownIsFalse("unknown"), false);
    assert.equal(unknownIsConfirmedAbsence("unknown"), false);
    assert.equal(unknownIsConfirmedAbsence("confirmed_absent"), true);
  });
});

describe("typed claims, evidence, and snapshots", () => {
  it("lets one source support one claim while not supporting another", () => {
    const evidence = [
      { id: "ev-kvm", sourceId: "src-1", snapshotId: snapshot.id },
      { id: "ev-gpu", sourceId: "src-1", snapshotId: snapshot.id },
    ];
    const links = [
      { claimId: "claim-kvm", evidenceId: "ev-kvm", stance: "supports" as const },
      { claimId: "claim-gpu", evidenceId: "ev-gpu", stance: "neutral" as const },
    ];
    assert.equal(
      sourceSupportsClaim({ sourceId: "src-1", claimId: "claim-kvm", evidence, links }),
      true
    );
    assert.equal(
      sourceSupportsClaim({ sourceId: "src-1", claimId: "claim-gpu", evidence, links }),
      false
    );
  });

  it("resolves contradictory evidence as conflicting, not majority truth", () => {
    assert.equal(resolveKnowledgeState(["supports"]), "present");
    assert.equal(resolveKnowledgeState(["contradicts"]), "confirmed_absent");
    assert.equal(resolveKnowledgeState(["supports", "contradicts"]), "conflicting");
    assert.equal(resolveKnowledgeState(["neutral"]), "unknown");
    assert.equal(resolveKnowledgeState([]), "unknown");
  });

  it("does not let replay or import time become observation time", () => {
    const observed = assignObservationTime({
      knownObservedAt: "2024-01-15T00:00:00Z",
      importedAt: "2026-09-09T12:00:00Z",
      replayedAt: "2026-09-09T13:00:00Z",
    });
    assert.equal(observed, "2024-01-15T00:00:00Z");
    assert.equal(
      assignObservationTime({
        knownObservedAt: null,
        importedAt: "2026-09-09T12:00:00Z",
        replayedAt: "2026-09-09T13:00:00Z",
      }),
      null
    );
  });

  it("refuses to present expired evidence as freshly verified", () => {
    assert.equal(
      canPresentAsFreshlyVerified({
        assessmentState: "independently_verified",
        validTo: "2026-01-01T00:00:00Z",
        now: "2026-09-09T00:00:00Z",
      }),
      false
    );
    assert.equal(
      canPresentAsFreshlyVerified({
        assessmentState: "independently_verified",
        validTo: null,
        now: "2026-09-09T00:00:00Z",
      }),
      true
    );
    assert.equal(
      canPresentAsFreshlyVerified({
        assessmentState: "legacy/unverified",
        validTo: null,
        now: "2026-09-09T00:00:00Z",
      }),
      false
    );
  });

  it("requires the quoted excerpt to exist in the referenced immutable snapshot", () => {
    assert.equal(excerptExistsInSnapshot("offers KVM virtual machines", snapshot.body), true);
    assert.equal(excerptExistsInSnapshot("bare metal everywhere", snapshot.body), false);
    const ok = validateQuotedExcerpt(
      { id: "ev-1", snapshotId: snapshot.id, excerpt: "offers KVM virtual machines" },
      snapshot
    );
    assert.equal(ok.ok, true);
    const missing = validateQuotedExcerpt(
      { id: "ev-2", snapshotId: snapshot.id, excerpt: "SOC 2 Type II certified" },
      snapshot
    );
    assert.equal(missing.ok, false);
  });

  it("rejects claims that mix unknown with fabricated verification", () => {
    const claim = {
      subjectType: "provider" as const,
      subjectId: "local-packages",
      claimType: "hypervisor",
      value: { text: "KVM" },
      knowledgeState: "unknown" as const,
      assessmentState: "independently_verified" as const,
      observedAt: null,
      recordedAt: "2026-09-09T00:00:00Z",
      validFrom: null,
      validTo: null,
    };
    assert.equal(validateClaim(claim).ok, false);
    assert.equal(
      validateClaim({
        ...claim,
        knowledgeState: "present",
        assessmentState: "legacy/unverified",
      }).ok,
      true
    );
  });
});
