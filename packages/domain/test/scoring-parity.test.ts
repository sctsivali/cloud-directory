import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CURRENT_METHODOLOGY } from "../src/scoring/methodology.ts";
import { scoreOfferingDeployment } from "../src/scoring/engine.ts";
import { explainForSurface, SURFACES } from "../src/scoring/surfaces.ts";
import { scoreWithFallback } from "../src/scoring/fallback.ts";
import { subjectFixture } from "./scoring-fixtures.ts";

describe("cross-surface score parity", () => {
  it("returns the same explanation from every public surface", () => {
    const input = {
      subject: subjectFixture(),
      methodology: CURRENT_METHODOLOGY,
      dataRevision: "rev-parity",
    };
    const canonical = scoreOfferingDeployment(input);
    for (const surface of SURFACES) {
      const explained = explainForSurface(surface, input);
      assert.deepEqual(explained.components, canonical.components, surface);
      assert.equal(explained.composite, canonical.composite, surface);
      assert.equal(explained.rankingLowerBound, canonical.rankingLowerBound, surface);
      assert.equal(explained.uncertainty, canonical.uncertainty, surface);
      assert.equal(explained.recommendationGroup, canonical.recommendationGroup, surface);
      assert.equal(explained.algorithmVersion, canonical.algorithmVersion, surface);
      assert.equal(explained.rulesetHash, canonical.rulesetHash, surface);
      assert.equal(explained.dataRevision, canonical.dataRevision, surface);
      assert.deepEqual(explained.reasonCodes, canonical.reasonCodes, surface);
      assert.equal(explained.engine, "canonical", surface);
    }
  });
});

describe("legacy fallback", () => {
  it("labels fallback when canonical offering/deployment data is missing", () => {
    const fallback = scoreWithFallback({
      canonical: null,
      legacyProvider: {
        id: "local-packages",
        name: "Nusantara Compute",
        sov: 80,
        oss: 85,
        conf: 70,
      },
      methodology: CURRENT_METHODOLOGY,
      dataRevision: "rev-fb",
    });
    assert.equal(fallback.engine, "legacy-fallback");
    assert.ok(fallback.fallbackLabel?.toLowerCase().includes("legacy"));
    assert.ok(fallback.reasonCodes.includes("LEGACY_FALLBACK"));
    assert.ok(fallback.reasonCodes.includes("CANONICAL_DATA_UNAVAILABLE"));
    assert.equal(fallback.algorithmVersion, CURRENT_METHODOLOGY.algorithmVersion);
    assert.equal(fallback.rulesetHash, CURRENT_METHODOLOGY.rulesetHash);
    assert.equal(fallback.legacy?.sov, 80);
  });

  it("does not treat fallback as the canonical engine", () => {
    const fallback = scoreWithFallback({
      canonical: null,
      legacyProvider: { id: "x", name: "X", sov: 0, oss: 0, conf: 0 },
      methodology: CURRENT_METHODOLOGY,
      dataRevision: "rev-fb2",
    });
    assert.notEqual(fallback.engine, "canonical");
    assert.equal(fallback.composite, null);
  });
});
