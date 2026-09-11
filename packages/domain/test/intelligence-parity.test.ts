import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { publicOutlookEligibilityView } from "../src/intelligence/outlook.ts";
import { buildCountryTimeline, buildProviderTimeline } from "../src/intelligence/timeline.ts";
import { buildOutlook } from "../src/intelligence/outlook.ts";
import { buildTrendReport, publicTrendView, trendsForSurface } from "../src/intelligence/trends.ts";
import { INTELLIGENCE_SURFACES } from "../src/intelligence/types.ts";
import { LONGITUDINAL_DATA_REVISION, LONGITUDINAL_WINDOW, longitudinalFacts } from "./intelligence-fixtures.ts";

const query = {
  facts: longitudinalFacts(),
  window: { ...LONGITUDINAL_WINDOW },
  countryCode: "ID" as const,
  dataRevision: LONGITUDINAL_DATA_REVISION,
};

describe("intelligence cross-surface parity", () => {
  it("matches API, UI, and MCP trend payloads", () => {
    const expected = publicTrendView(buildTrendReport(query));
    for (const surface of INTELLIGENCE_SURFACES) {
      assert.deepEqual(publicTrendView(trendsForSurface(surface, query)), expected, surface);
    }
  });

  it("keeps timeline provenance identical for the same revision", () => {
    const provider = buildProviderTimeline({ ...query, providerId: "prov-a" });
    const country = buildCountryTimeline({ ...query, countryCode: "ID" });
    assert.equal(provider.methodologyHash, country.methodologyHash);
    assert.equal(provider.dataRevision, country.dataRevision);
    const overlapping = provider.events.filter((e) => e.countryCode === "ID").map((e) => e.receiptId);
    for (const id of overlapping) {
      assert.ok(country.events.some((e) => e.receiptId === id), id);
    }
  });

    it("exposes eligibility without a forecast payload on the MCP view", () => {
      const outlook = buildOutlook(query, "technology_adoption");
      const view = publicOutlookEligibilityView(outlook);
      assert.equal(view.forecastPublished, false);
      assert.equal("pointEstimate" in view, false);
      assert.ok(view.eligibility);
    });

    it("aggregates twenty concurrent trend reports without drift", async () => {
      const expected = publicTrendView(buildTrendReport(query));
      const results = await Promise.all(
        Array.from({ length: 20 }, () => publicTrendView(buildTrendReport(query)))
      );
      assert.equal(results.length, 20);
      for (const row of results) {
        assert.deepEqual(row, expected);
      }
    });
  });
