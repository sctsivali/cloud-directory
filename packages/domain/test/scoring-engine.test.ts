import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CURRENT_METHODOLOGY } from "../src/scoring/methodology.ts";
import { compareScoreExplanations, scoreOfferingDeployment } from "../src/scoring/engine.ts";
import { bound, subjectFixture } from "./scoring-fixtures.ts";

describe("offering/deployment scoring engine", () => {
  it("emits explainable components, reason codes, uncertainty, and version stamps", () => {
    const scored = scoreOfferingDeployment({
      subject: subjectFixture(),
      methodology: CURRENT_METHODOLOGY,
      dataRevision: "rev-1",
    });
    assert.equal(scored.algorithmVersion, "1.0.0");
    assert.equal(scored.methodologyId, CURRENT_METHODOLOGY.id);
    assert.equal(scored.rulesetHash, CURRENT_METHODOLOGY.rulesetHash);
    assert.equal(scored.dataRevision, "rev-1");
    assert.equal(scored.engine, "canonical");
    assert.equal(scored.components.length, 9);
    assert.ok(scored.composite != null && scored.composite > 50);
    assert.ok(scored.uncertainty >= 0 && scored.uncertainty < 0.5);
    assert.ok(scored.reasonCodes.length > 0);
    assert.match(scored.tieBreakKey, /off-1/);
  });

  it("breaks score ties deterministically by offering then deployment then provider", () => {
    const a = scoreOfferingDeployment({
      subject: subjectFixture({ offeringId: "off-b", deploymentId: "dep-z", providerId: "p-2" }),
      methodology: CURRENT_METHODOLOGY,
      dataRevision: "rev-tie",
    });
    const b = scoreOfferingDeployment({
      subject: subjectFixture({ offeringId: "off-a", deploymentId: "dep-z", providerId: "p-1" }),
      methodology: CURRENT_METHODOLOGY,
      dataRevision: "rev-tie",
    });
    assert.equal(a.composite, b.composite);
    const first = [a, b].sort(compareScoreExplanations);
    const second = [b, a].sort(compareScoreExplanations);
    assert.deepEqual(
      first.map((x) => x.offeringId),
      ["off-a", "off-b"]
    );
    assert.deepEqual(
      second.map((x) => x.offeringId),
      ["off-a", "off-b"]
    );
  });

  it("does not inherit provider-scope technology without universal-scope evidence", () => {
    const inherited = subjectFixture({
      technologies: [
        {
          slug: "kvm",
          category: "hypervisor",
          knowledgeState: "present",
          scope: "provider",
          scopeId: "prov-1",
          hasUniversalScopeEvidence: false,
          appliesToSubject: false,
        },
      ],
    });
    const scored = scoreOfferingDeployment({
      subject: inherited,
      methodology: CURRENT_METHODOLOGY,
      dataRevision: "rev-tech",
    });
    const oss = scored.components.find((c) => c.dimension === "open_technology_portability");
    assert.ok(oss);
    assert.equal(oss.knowledgeState, "unknown");
    assert.equal(oss.rawValue, null);
    assert.ok(oss.reasonCodes.includes("TECH_NOT_INHERITED"));
  });

  it("scores commercial unknown as null when currency or amount is missing", () => {
    const scored = scoreOfferingDeployment({
      subject: subjectFixture({
        commercial: bound("unknown", null),
      }),
      methodology: CURRENT_METHODOLOGY,
      dataRevision: "rev-price",
    });
    const commercial = scored.components.find((c) => c.dimension === "commercial_comparability");
    assert.ok(commercial);
    assert.equal(commercial.rawValue, null);
    assert.equal(commercial.knowledgeState, "unknown");
  });
});
