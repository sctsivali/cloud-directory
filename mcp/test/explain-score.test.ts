import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CURRENT_METHODOLOGY,
  explainForSurface,
  scoreOfferingDeployment,
  scoreWithFallback,
} from "../../packages/domain/src/scoring/index.ts";
import { subjectFixture } from "../../packages/domain/test/scoring-fixtures.ts";

describe("MCP explain_score shares the scoring engine", () => {
  it("matches arena/wizard/methodology explanations for the same subject", () => {
    const input = {
      subject: subjectFixture(),
      methodology: CURRENT_METHODOLOGY,
      dataRevision: "rev-mcp",
    };
    const mcp = explainForSurface("mcp", input);
    const arena = explainForSurface("arena", input);
    const engine = scoreOfferingDeployment(input);
    assert.deepEqual(mcp.components, engine.components);
    assert.deepEqual(mcp.components, arena.components);
    assert.equal(mcp.rulesetHash, engine.rulesetHash);
    assert.equal(mcp.engine, "canonical");
  });

  it("returns a labeled legacy fallback when no canonical subject exists", () => {
    const fallback = scoreWithFallback({
      canonical: null,
      legacyProvider: { id: "p1", name: "P", sov: 10, oss: 20, conf: 30 },
      methodology: CURRENT_METHODOLOGY,
      dataRevision: "legacy-public-tables",
    });
    assert.equal(fallback.engine, "legacy-fallback");
    assert.ok(fallback.fallbackLabel?.toLowerCase().includes("legacy"));
    assert.ok(fallback.reasonCodes.includes("CANONICAL_DATA_UNAVAILABLE"));
  });
});
