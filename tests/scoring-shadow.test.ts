import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareScoringVersions, renderShadowMarkdown } from "../scripts/compare_scoring_versions.ts";
import { loadProviderFixtures } from "./load-fixtures.ts";

describe("scoring shadow comparison", () => {
  it("reports ranking changes with reason codes and does not bless a cutover", () => {
    const rows = compareScoringVersions(loadProviderFixtures());
    assert.ok(rows.length >= 3);
    for (const row of rows) {
      assert.ok(row.reasonCodes.length > 0, row.providerId);
      assert.ok(row.rankingChange.length > 0, row.providerId);
      assert.ok(row.engine === "canonical" || row.engine === "legacy-fallback", row.providerId);
    }
    const markdown = renderShadowMarkdown(rows);
    assert.match(markdown, /Do not replace public ranking/);
    assert.match(markdown, /Legacy SOV/);
  });
});
