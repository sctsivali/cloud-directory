import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CURRENT_METHODOLOGY,
  SCORING_DIMENSIONS,
  hashRuleset,
  unknownDoesNotScoreAsZero,
  type MethodologyRuleset,
} from "../src/scoring/methodology.ts";
import { scoreOfferingDeployment } from "../src/scoring/engine.ts";
import { subjectFixture } from "./scoring-fixtures.ts";

describe("versioned methodology", () => {
  it("pins algorithm version, dimensions, and a stable ruleset hash", () => {
    assert.equal(CURRENT_METHODOLOGY.id, "asean-offering-deployment-v1");
    assert.equal(CURRENT_METHODOLOGY.algorithmVersion, "1.0.0");
    assert.deepEqual([...SCORING_DIMENSIONS], [
      "primary_data_residency",
      "backup_residency",
      "metadata_control_plane_residency",
      "contracting_entity_legal_control",
      "administrative_access_key_control",
      "evidence_coverage",
      "evidence_quality",
      "open_technology_portability",
      "commercial_comparability",
    ]);
    assert.match(CURRENT_METHODOLOGY.rulesetHash, /^[0-9a-f]{64}$/);
    assert.equal(hashRuleset(CURRENT_METHODOLOGY.ruleset), CURRENT_METHODOLOGY.rulesetHash);
    assert.equal(hashRuleset(CURRENT_METHODOLOGY.ruleset), hashRuleset(CURRENT_METHODOLOGY.ruleset));
    const sql = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "migrations", "0008_scoring_runs.sql"),
      "utf8"
    );
    assert.match(sql, new RegExp(CURRENT_METHODOLOGY.rulesetHash));
    assert.match(sql, /asean-offering-deployment-v1/);
    assert.match(sql, /evidence_readiness/);
    assert.match(sql, /ranking_lower_bound/);
  });

  it("changes the ruleset hash when a weight or evidence-readiness policy changes", () => {
    const tweakedWeight: MethodologyRuleset = {
      ...CURRENT_METHODOLOGY.ruleset,
      weights: { ...CURRENT_METHODOLOGY.ruleset.weights, evidence_quality: 99 },
    };
    const tweakedReadiness: MethodologyRuleset = {
      ...CURRENT_METHODOLOGY.ruleset,
      evidenceReadiness: {
        ...CURRENT_METHODOLOGY.ruleset.evidenceReadiness,
        minCoverage: 0.9,
      },
    };
    assert.notEqual(hashRuleset(tweakedWeight), CURRENT_METHODOLOGY.rulesetHash);
    assert.notEqual(hashRuleset(tweakedReadiness), CURRENT_METHODOLOGY.rulesetHash);
  });

  it("does not collapse unknown into zero on any dimension", () => {
    const unknown = subjectFixture({
      primaryResidency: { knowledgeState: "unknown", value: null },
      backupResidency: { knowledgeState: "unknown", value: null },
      metadataResidency: { knowledgeState: "unknown", value: null },
      contractingEntity: { knowledgeState: "unknown", value: null },
      administrativeAccess: { knowledgeState: "unknown", value: null },
      keyControl: { knowledgeState: "unknown", value: null },
      technologies: [],
      commercial: { knowledgeState: "unknown", value: null },
      evidenceItems: [],
      facility: { knowledgeState: "unknown", value: null },
    });
    const scored = scoreOfferingDeployment({
      subject: unknown,
      methodology: CURRENT_METHODOLOGY,
      dataRevision: "rev-unknown",
    });
    for (const component of scored.components) {
      assert.equal(unknownDoesNotScoreAsZero(component), true, component.dimension);
      assert.equal(component.rawValue, null, component.dimension);
      assert.equal(component.knowledgeState, "unknown", component.dimension);
    }
    assert.equal(scored.composite, null);
    assert.equal(scored.rankingLowerBound, null);
    assert.ok(scored.uncertainty > 0.9);
    assert.ok(scored.reasonCodes.includes("UNKNOWN_NOT_ZERO"));
    assert.equal(scored.recommendationGroup, "needs_verification");
    assert.ok(scored.reasonCodes.includes("EVIDENCE_NOT_READY"));
  });

  it("keeps confirmed_absent distinct from unknown and conflicting", () => {
    const absent = subjectFixture({
      primaryResidency: { knowledgeState: "confirmed_absent", value: null },
      backupResidency: { knowledgeState: "conflicting", value: null },
      metadataResidency: { knowledgeState: "unknown", value: null },
    });
    const scored = scoreOfferingDeployment({
      subject: absent,
      methodology: CURRENT_METHODOLOGY,
      dataRevision: "rev-states",
    });
    const byDim = Object.fromEntries(scored.components.map((c) => [c.dimension, c]));
    assert.equal(byDim.primary_data_residency.knowledgeState, "confirmed_absent");
    assert.equal(byDim.primary_data_residency.rawValue, 0);
    assert.ok(byDim.primary_data_residency.reasonCodes.includes("CONFIRMED_ABSENT"));
    assert.equal(byDim.backup_residency.knowledgeState, "conflicting");
    assert.equal(byDim.backup_residency.rawValue, null);
    assert.ok(byDim.backup_residency.reasonCodes.includes("CONFLICTING"));
    assert.equal(byDim.metadata_control_plane_residency.knowledgeState, "unknown");
    assert.equal(byDim.metadata_control_plane_residency.rawValue, null);
    assert.ok(byDim.metadata_control_plane_residency.reasonCodes.includes("UNKNOWN"));
  });
});
