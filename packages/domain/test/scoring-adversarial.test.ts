import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { flattenRecommendations, recommendSubjects } from "../src/recommendation/ranking.ts";
import { compareScoreExplanations, scoreOfferingDeployment } from "../src/scoring/engine.ts";
import {
  CURRENT_METHODOLOGY,
  defineMethodology,
  type MethodologyRuleset,
} from "../src/scoring/methodology.ts";
import { explainForSurface, SURFACES } from "../src/scoring/surfaces.ts";
import { bound, requiredEvidenceItems, subjectFixture } from "./scoring-fixtures.ts";

function withRuleset(overrides: Partial<MethodologyRuleset>) {
  const base = CURRENT_METHODOLOGY.ruleset;
  return defineMethodology({
    id: "adversarial-methodology",
    algorithmVersion: CURRENT_METHODOLOGY.algorithmVersion,
    ruleset: {
      ...base,
      ...overrides,
      weights: { ...base.weights, ...(overrides.weights ?? {}) },
      evidenceReadiness: {
        ...base.evidenceReadiness,
        ...(overrides.evidenceReadiness ?? {}),
      },
    },
  });
}

function sparsePerfectPrimary(id = "off-sparse") {
  return subjectFixture({
    offeringId: id,
    deploymentId: `dep-${id}`,
    providerId: `prov-${id}`,
    primaryResidency: bound("present", "Indonesia"),
    backupResidency: bound("unknown", null),
    metadataResidency: bound("unknown", null),
    contractingEntity: bound("unknown", null),
    administrativeAccess: bound("unknown", null),
    keyControl: bound("unknown", null),
    technologies: [],
    commercial: bound("unknown", null),
    evidenceItems: [],
    facility: bound("unknown", null),
  });
}

function completeImperfect(id = "off-complete") {
  return subjectFixture({
    offeringId: id,
    deploymentId: `dep-${id}`,
    providerId: `prov-${id}`,
    backupResidency: bound("present", "Australia"),
    evidenceItems: requiredEvidenceItems("editorially_reviewed"),
  });
}

describe("adversarial evidence coverage intersection", () => {
  it("does not let irrelevant claim types inflate coverage", () => {
    const required = CURRENT_METHODOLOGY.ruleset.requiredEvidenceClaimTypes;
    const irrelevant = Array.from({ length: required.length }, (_, i) => ({
      claimType: `press_release_${i}`,
      assessmentState: "independently_verified" as const,
      knowledgeState: "present" as const,
      independent: true,
      freshnessDays: 1,
      excerptPresent: true,
    }));
    const scored = scoreOfferingDeployment({
      subject: subjectFixture({ evidenceItems: irrelevant }),
      methodology: CURRENT_METHODOLOGY,
      dataRevision: "rev-cov-irrelevant",
    });
    const coverage = scored.components.find((c) => c.dimension === "evidence_coverage");
    assert.ok(coverage);
    assert.equal(coverage.rawValue, 0);
    assert.ok((coverage.rawValue ?? 1) < CURRENT_METHODOLOGY.ruleset.evidenceReadiness.minCoverage);
  });

  it("counts only the intersection with methodology.requiredEvidenceClaimTypes", () => {
    const required = CURRENT_METHODOLOGY.ruleset.requiredEvidenceClaimTypes;
    const mixed = [
      ...required.slice(0, 2).map((claimType) => ({
        claimType,
        assessmentState: "independently_verified" as const,
        knowledgeState: "present" as const,
        independent: true,
        freshnessDays: 1,
        excerptPresent: true,
      })),
      ...Array.from({ length: 20 }, (_, i) => ({
        claimType: `marketing_${i}`,
        assessmentState: "independently_verified" as const,
        knowledgeState: "present" as const,
        independent: true,
        freshnessDays: 1,
        excerptPresent: true,
      })),
    ];
    const scored = scoreOfferingDeployment({
      subject: subjectFixture({ evidenceItems: mixed }),
      methodology: CURRENT_METHODOLOGY,
      dataRevision: "rev-cov-mix",
    });
    const coverage = scored.components.find((c) => c.dimension === "evidence_coverage");
    assert.ok(coverage);
    assert.equal(coverage.rawValue, 2 / required.length);
  });
});

describe("adversarial evidence-readiness and ranking lower bound", () => {
  it("pins a versioned evidence-readiness policy on the methodology", () => {
    const policy = CURRENT_METHODOLOGY.ruleset.evidenceReadiness;
    assert.ok(policy.minCoverage > 0 && policy.minCoverage <= 1);
    assert.ok(policy.criticalDimensions.length > 0);
    assert.ok(policy.criticalDimensions.includes("primary_data_residency"));
    assert.ok(policy.materialConflictClaimTypes.length > 0);
    assert.ok(policy.materialConflictShare > 0);
    const tweaked = withRuleset({
      evidenceReadiness: { ...policy, minCoverage: policy.minCoverage + 0.1 },
    });
    assert.notEqual(tweaked.rulesetHash, CURRENT_METHODOLOGY.rulesetHash);
  });

  it("places a no-hard-fail sparse perfect dimension in needs_verification", () => {
    const scored = scoreOfferingDeployment({
      subject: sparsePerfectPrimary(),
      methodology: CURRENT_METHODOLOGY,
      dataRevision: "rev-sparse",
    });
    assert.equal(scored.composite, 100);
    assert.ok(scored.uncertainty > 0.7);
    assert.equal(scored.recommendationGroup, "needs_verification");
    assert.ok(scored.reasonCodes.includes("EVIDENCE_NOT_READY"));
    assert.ok(
      scored.reasonCodes.includes("CRITICAL_DIMENSION_UNKNOWN") ||
        scored.reasonCodes.includes("COVERAGE_BELOW_THRESHOLD")
    );
    for (const component of scored.components) {
      if (component.knowledgeState === "unknown") {
        assert.equal(component.rawValue, null, component.dimension);
      }
    }
  });

  it("keeps a complete ~90 eligible and ranks it ahead of sparse 100", () => {
    const sparse = scoreOfferingDeployment({
      subject: sparsePerfectPrimary(),
      methodology: CURRENT_METHODOLOGY,
      dataRevision: "rev-rank",
    });
    const complete = scoreOfferingDeployment({
      subject: completeImperfect(),
      methodology: CURRENT_METHODOLOGY,
      dataRevision: "rev-rank",
    });
    assert.equal(sparse.composite, 100);
    assert.ok(complete.composite != null && complete.composite >= 85 && complete.composite < 100);
    assert.equal(complete.recommendationGroup, "eligible");
    assert.equal(sparse.recommendationGroup, "needs_verification");
    assert.ok(sparse.rankingLowerBound != null && complete.rankingLowerBound != null);
    assert.ok(sparse.rankingLowerBound < complete.rankingLowerBound);
    assert.ok(sparse.rankingLowerBound < sparse.composite);
    assert.equal(complete.rankingLowerBound, complete.composite);

    const ranked = [sparse, complete].sort(compareScoreExplanations);
    assert.equal(ranked[0]?.offeringId, "off-complete");
    const buckets = recommendSubjects({
      subjects: [sparsePerfectPrimary(), completeImperfect()],
      constraints: {},
      methodology: CURRENT_METHODOLOGY,
      dataRevision: "rev-rank",
    });
    assert.equal(buckets.eligible[0]?.offeringId, "off-complete");
    assert.equal(flattenRecommendations(buckets)[0]?.offeringId, "off-complete");
    assert.ok(buckets.needs_verification.some((row) => row.offeringId === "off-sparse"));
  });

  it("uses rankingLowerBound before composite inside the same recommendation group", () => {
    const loose = withRuleset({
      evidenceReadiness: {
        minCoverage: 0,
        criticalDimensions: [],
        materialConflictClaimTypes: [],
        materialConflictShare: 1,
      },
    });
    const sparse = scoreOfferingDeployment({
      subject: sparsePerfectPrimary("off-loose-sparse"),
      methodology: loose,
      dataRevision: "rev-loose",
    });
    const complete = scoreOfferingDeployment({
      subject: completeImperfect("off-loose-complete"),
      methodology: loose,
      dataRevision: "rev-loose",
    });
    assert.equal(sparse.recommendationGroup, complete.recommendationGroup);
    assert.ok((sparse.composite ?? 0) > (complete.composite ?? 0));
    assert.ok((sparse.rankingLowerBound ?? 0) < (complete.rankingLowerBound ?? 0));
    const first = [sparse, complete].sort(compareScoreExplanations);
    const second = [complete, sparse].sort(compareScoreExplanations);
    assert.equal(first[0]?.offeringId, "off-loose-complete");
    assert.equal(second[0]?.offeringId, "off-loose-complete");
  });

  it("does not let recommendSubjects clobber readiness with a passing constraint group", () => {
    const buckets = recommendSubjects({
      subjects: [sparsePerfectPrimary()],
      constraints: {},
      methodology: CURRENT_METHODOLOGY,
      dataRevision: "rev-clobber",
    });
    assert.equal(buckets.eligible.length, 0);
    assert.equal(buckets.needs_verification[0]?.recommendationGroup, "needs_verification");
  });
});

describe("adversarial open-technology reproducibility", () => {
  it("scores open technology from the supplied methodology, not CURRENT_METHODOLOGY", () => {
    const custom = withRuleset({ openTechnologySlugs: ["custom-open"] });
    const kvmOnly = subjectFixture({
      technologies: [
        {
          slug: "kvm",
          category: "hypervisor",
          knowledgeState: "present",
          scope: "offering",
          scopeId: "off-1",
          hasUniversalScopeEvidence: false,
          appliesToSubject: true,
        },
      ],
    });
    const customOnly = subjectFixture({
      technologies: [
        {
          slug: "custom-open",
          category: "hypervisor",
          knowledgeState: "present",
          scope: "offering",
          scopeId: "off-1",
          hasUniversalScopeEvidence: false,
          appliesToSubject: true,
        },
      ],
    });
    const kvmOnCustom = scoreOfferingDeployment({
      subject: kvmOnly,
      methodology: custom,
      dataRevision: "rev-oss-custom",
    });
    const customOnCustom = scoreOfferingDeployment({
      subject: customOnly,
      methodology: custom,
      dataRevision: "rev-oss-custom",
    });
    const kvmOnCurrent = scoreOfferingDeployment({
      subject: kvmOnly,
      methodology: CURRENT_METHODOLOGY,
      dataRevision: "rev-oss-current",
    });
    const oss = (row: typeof kvmOnCustom) =>
      row.components.find((c) => c.dimension === "open_technology_portability");
    assert.equal(oss(kvmOnCustom)?.reasonCodes.includes("OPEN_TECH_NONE_MATCHED"), true);
    assert.ok((oss(kvmOnCustom)?.rawValue ?? 1) < (oss(kvmOnCurrent)?.rawValue ?? 0));
    assert.equal(oss(customOnCustom)?.reasonCodes.includes("OPEN_TECH_PRESENT"), true);
    assert.ok((oss(customOnCustom)?.rawValue ?? 0) > 0);
    assert.notEqual(custom.rulesetHash, CURRENT_METHODOLOGY.rulesetHash);
  });
});

describe("adversarial evidence quality conflicts", () => {
  it("does not average conflicting evidence into a positive quality score", () => {
    const scored = scoreOfferingDeployment({
      subject: subjectFixture({
        evidenceItems: [
          {
            claimType: "primary_residency",
            assessmentState: "independently_verified",
            knowledgeState: "present",
            independent: true,
            freshnessDays: 4,
            excerptPresent: true,
          },
          {
            claimType: "primary_residency",
            assessmentState: "independently_verified",
            knowledgeState: "conflicting",
            independent: true,
            freshnessDays: 4,
            excerptPresent: true,
          },
          {
            claimType: "legal_entity",
            assessmentState: "editorially_reviewed",
            knowledgeState: "present",
            independent: false,
            freshnessDays: 8,
            excerptPresent: true,
          },
        ],
      }),
      methodology: CURRENT_METHODOLOGY,
      dataRevision: "rev-quality-conflict",
    });
    const quality = scored.components.find((c) => c.dimension === "evidence_quality");
    assert.ok(quality);
    assert.equal(quality.knowledgeState, "conflicting");
    assert.equal(quality.rawValue, null);
    assert.equal(quality.weightedValue, null);
    assert.ok(quality.reasonCodes.includes("CONFLICTING") || quality.reasonCodes.includes("EVIDENCE_CONFLICT"));
    assert.equal(scored.recommendationGroup, "needs_verification");
    assert.ok(scored.reasonCodes.includes("EVIDENCE_CONFLICT") || scored.reasonCodes.includes("CRITICAL_DIMENSION_CONFLICTING"));
  });

  it("excludes irrelevant conflicts from the quality average without treating them as credit", () => {
    const scored = scoreOfferingDeployment({
      subject: subjectFixture({
        evidenceItems: [
          ...requiredEvidenceItems("independently_verified"),
          {
            claimType: "press_release",
            assessmentState: "independently_verified",
            knowledgeState: "conflicting",
            independent: false,
            freshnessDays: 1,
            excerptPresent: true,
          },
        ],
      }),
      methodology: CURRENT_METHODOLOGY,
      dataRevision: "rev-quality-irrelevant-conflict",
    });
    const quality = scored.components.find((c) => c.dimension === "evidence_quality");
    assert.ok(quality);
    assert.equal(quality.knowledgeState, "present");
    assert.equal(quality.rawValue, 1);
    assert.ok(quality.reasonCodes.includes("EVIDENCE_CONFLICT_EXCLUDED"));
    assert.ok(!quality.reasonCodes.includes("CONFLICTING"));
  });
});

describe("adversarial cross-surface parity", () => {
  it("keeps the four defect fixtures identical on every public surface", () => {
    const fixtures = [
      subjectFixture({
        offeringId: "parity-irrelevant",
        evidenceItems: [
          {
            claimType: "press_release",
            assessmentState: "independently_verified",
            knowledgeState: "present",
            independent: true,
            freshnessDays: 1,
            excerptPresent: true,
          },
        ],
      }),
      sparsePerfectPrimary("parity-sparse"),
      completeImperfect("parity-complete"),
      subjectFixture({
        offeringId: "parity-conflict",
        evidenceItems: [
          {
            claimType: "primary_residency",
            assessmentState: "independently_verified",
            knowledgeState: "present",
            independent: true,
            freshnessDays: 1,
            excerptPresent: true,
          },
          {
            claimType: "primary_residency",
            assessmentState: "independently_verified",
            knowledgeState: "conflicting",
            independent: true,
            freshnessDays: 1,
            excerptPresent: true,
          },
        ],
      }),
    ];
    for (const subject of fixtures) {
      const input = { subject, methodology: CURRENT_METHODOLOGY, dataRevision: "rev-adv-parity" };
      const canonical = scoreOfferingDeployment(input);
      for (const surface of SURFACES) {
        const explained = explainForSurface(surface, input);
        assert.deepEqual(explained.components, canonical.components, `${subject.offeringId}:${surface}`);
        assert.equal(explained.composite, canonical.composite, surface);
        assert.equal(explained.rankingLowerBound, canonical.rankingLowerBound, surface);
        assert.equal(explained.uncertainty, canonical.uncertainty, surface);
        assert.equal(explained.recommendationGroup, canonical.recommendationGroup, surface);
        assert.deepEqual(explained.reasonCodes, canonical.reasonCodes, surface);
        assert.equal(explained.rulesetHash, canonical.rulesetHash, surface);
      }
    }
  });
});
