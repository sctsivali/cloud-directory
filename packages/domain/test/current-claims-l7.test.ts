import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveCurrentClaims,
  type ClaimRecord,
} from "../src/current-claims.ts";

const NOW = "2026-09-10T12:00:00.000Z";

function claim(partial: Partial<ClaimRecord> & Pick<ClaimRecord, "id" | "value">): ClaimRecord {
  return {
    subjectType: "provider",
    subjectId: "local-packages",
    claimType: "hypervisor",
    knowledgeState: "present",
    assessmentState: "extracted",
    observedAt: "2026-06-01T00:00:00.000Z",
    recordedAt: "2026-01-01T00:00:00.000Z",
    validFrom: null,
    validTo: null,
    supersededBy: null,
    ...partial,
  };
}

function current(rows: ClaimRecord[], now = NOW) {
  return resolveCurrentClaims(rows, now);
}

describe("L7 current-claim resolver", () => {
  it("excludes rejected, expired, and not-yet-valid claims", () => {
    const rows = [
      claim({
        id: "rejected",
        value: { text: "rejected-first" },
        assessmentState: "rejected",
        observedAt: "2026-09-01T00:00:00.000Z",
        recordedAt: "2020-01-01T00:00:00.000Z",
      }),
      claim({
        id: "expired",
        value: { text: "expired" },
        observedAt: "2026-08-01T00:00:00.000Z",
        recordedAt: "2020-02-01T00:00:00.000Z",
        validTo: "2026-09-01T00:00:00.000Z",
      }),
      claim({
        id: "future",
        value: { text: "future" },
        observedAt: "2026-09-09T00:00:00.000Z",
        recordedAt: "2020-03-01T00:00:00.000Z",
        validFrom: "2026-12-01T00:00:00.000Z",
      }),
      claim({
        id: "valid",
        value: { text: "KVM" },
        observedAt: "2026-05-01T00:00:00.000Z",
        recordedAt: "2026-09-09T00:00:00.000Z",
      }),
    ];
    const resolved = current(rows);
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0]?.id, "valid");
    assert.equal((resolved[0]?.value as { text: string }).text, "KVM");
    assert.equal(resolved[0]?.assessmentState, "extracted");
  });

  it("follows superseded_by chains and never selects the first-recorded claim", () => {
    const rows = [
      claim({
        id: "first-recorded",
        value: { text: "Xen" },
        observedAt: "2024-01-01T00:00:00.000Z",
        recordedAt: "2020-01-01T00:00:00.000Z",
        supersededBy: "middle",
      }),
      claim({
        id: "middle",
        value: { text: "ESXi" },
        observedAt: "2025-01-01T00:00:00.000Z",
        recordedAt: "2021-01-01T00:00:00.000Z",
        supersededBy: "head",
      }),
      claim({
        id: "head",
        value: { text: "KVM" },
        assessmentState: "independently_verified",
        observedAt: "2026-01-01T00:00:00.000Z",
        recordedAt: "2022-01-01T00:00:00.000Z",
      }),
    ];
    const resolved = current(rows);
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0]?.id, "head");
    assert.equal((resolved[0]?.value as { text: string }).text, "KVM");
    assert.equal(resolved[0]?.assessmentState, "independently_verified");
    assert.notEqual(resolved[0]?.id, "first-recorded");
  });

  it("excludes cycles and invalid superseded_by links instead of picking first recorded", () => {
    const cyclic = [
      claim({
        id: "cycle-a",
        value: { text: "A" },
        recordedAt: "2020-01-01T00:00:00.000Z",
        supersededBy: "cycle-b",
      }),
      claim({
        id: "cycle-b",
        value: { text: "B" },
        recordedAt: "2021-01-01T00:00:00.000Z",
        supersededBy: "cycle-a",
      }),
    ];
    assert.deepEqual(current(cyclic), []);

    const dangling = [
      claim({
        id: "dangling",
        value: { text: "ghost" },
        recordedAt: "2020-01-01T00:00:00.000Z",
        supersededBy: "missing-claim",
      }),
      claim({
        id: "ok",
        value: { text: "KVM" },
        recordedAt: "2026-01-01T00:00:00.000Z",
      }),
    ];
    const resolved = current(dangling);
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0]?.id, "ok");
  });

  it("honours inclusive temporal boundaries at valid_from and valid_to", () => {
    const onFrom = claim({
      id: "on-from",
      value: { text: "from" },
      validFrom: NOW,
      recordedAt: "2026-09-10T11:00:00.000Z",
    });
    const onTo = claim({
      id: "on-to",
      claimType: "orchestration",
      value: { text: "to" },
      validTo: NOW,
      recordedAt: "2026-09-10T11:00:00.000Z",
    });
    const beforeFrom = claim({
      id: "before-from",
      claimType: "storage",
      value: { text: "early" },
      validFrom: "2026-09-10T12:00:00.001Z",
    });
    const afterTo = claim({
      id: "after-to",
      claimType: "control_plane",
      value: { text: "late" },
      validTo: "2026-09-10T11:59:59.999Z",
    });
    const resolved = current([onFrom, onTo, beforeFrom, afterTo]);
    assert.deepEqual(
      resolved.map((row) => row.id).sort(),
      ["on-from", "on-to"]
    );
  });

  it("breaks equal observation time deterministically by id, not first recorded", () => {
    const earlierRecord = claim({
      id: "claim-a",
      value: { text: "KVM" },
      observedAt: "2026-06-01T00:00:00.000Z",
      recordedAt: "2020-01-01T00:00:00.000Z",
      assessmentState: "independently_verified",
      evidenceIds: ["ev-a"],
    });
    const laterRecord = claim({
      id: "claim-z",
      value: { text: "KVM" },
      observedAt: "2026-06-01T00:00:00.000Z",
      recordedAt: "2026-09-01T00:00:00.000Z",
      assessmentState: "independently_verified",
      evidenceIds: ["ev-z"],
    });
    const resolved = current([earlierRecord, laterRecord]);
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0]?.id, "claim-z");
    assert.deepEqual(resolved[0]?.evidenceIds, ["ev-z"]);
    assert.notEqual(resolved[0]?.id, "claim-a");
  });

  it("preserves higher assessment and evidence authority over a later weaker observation", () => {
    const verified = claim({
      id: "verified",
      value: { text: "KVM" },
      assessmentState: "independently_verified",
      observedAt: "2025-01-01T00:00:00.000Z",
      recordedAt: "2025-01-02T00:00:00.000Z",
      evidenceIds: ["ev-verified"],
    });
    const extractedLater = claim({
      id: "extracted-later",
      value: { text: "Xen" },
      assessmentState: "extracted",
      observedAt: "2026-08-01T00:00:00.000Z",
      recordedAt: "2026-08-02T00:00:00.000Z",
      evidenceIds: ["ev-extracted"],
    });
    const resolved = current([extractedLater, verified]);
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0]?.id, "verified");
    assert.equal(resolved[0]?.assessmentState, "independently_verified");
    assert.equal((resolved[0]?.value as { text: string }).text, "KVM");
    assert.deepEqual(resolved[0]?.evidenceIds, ["ev-verified"]);
    assert.notEqual(resolved[0]?.id, "extracted-later");
  });

  it("emits conflicting when current valid authoritative sources disagree", () => {
    const kvm = claim({
      id: "src-kvm",
      value: { text: "KVM" },
      assessmentState: "independently_verified",
      observedAt: "2026-04-01T00:00:00.000Z",
      recordedAt: "2026-04-02T00:00:00.000Z",
      evidenceIds: ["ev-kvm"],
    });
    const xen = claim({
      id: "src-xen",
      value: { text: "Xen" },
      assessmentState: "independently_verified",
      observedAt: "2026-05-01T00:00:00.000Z",
      recordedAt: "2026-05-02T00:00:00.000Z",
      evidenceIds: ["ev-xen"],
    });
    const resolved = current([kvm, xen]);
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0]?.knowledgeState, "conflicting");
    assert.equal(resolved[0]?.value, null);
    assert.equal(resolved[0]?.assessmentState, "independently_verified");
    assert.equal(resolved[0]?.id, "src-xen");
    assert.deepEqual(resolved[0]?.contributingIds.slice().sort(), ["src-kvm", "src-xen"]);
    assert.deepEqual(resolved[0]?.evidenceIds?.slice().sort(), ["ev-kvm", "ev-xen"]);
  });
});
