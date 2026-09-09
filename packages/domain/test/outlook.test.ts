import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  backtestTrend,
  buildOutlook,
  outlookLayersAreSeparated,
  publicOutlookEligibilityView,
  refuseForecastPublication,
} from "../src/intelligence/outlook.ts";
import { OUTLOOK_LAYERS } from "../src/intelligence/types.ts";
import {
  denseEligibleFacts,
  LONGITUDINAL_DATA_REVISION,
  LONGITUDINAL_WINDOW,
  longitudinalFacts,
  oscillatingPriceFacts,
  monotonicPriceFacts,
} from "./intelligence-fixtures.ts";

const sparseQuery = {
  facts: longitudinalFacts(),
  window: { ...LONGITUDINAL_WINDOW },
  countryCode: "ID",
  dataRevision: LONGITUDINAL_DATA_REVISION,
};

const denseQuery = {
  facts: denseEligibleFacts(),
  window: { ...LONGITUDINAL_WINDOW },
  countryCode: "ID",
  dataRevision: LONGITUDINAL_DATA_REVISION,
};

describe("outlook contract", () => {
  it("keeps observed fact, trend, signal, assessment, and forecast as distinct layers", () => {
    const doc = buildOutlook(sparseQuery, "provider_count_by_country");
    assert.deepEqual(
      [doc.observedFact.layer, doc.measuredTrend.layer, doc.signal.layer, doc.assessment.layer],
      ["observed_fact", "measured_trend", "signal", "assessment"]
    );
    assert.ok(outlookLayersAreSeparated(doc));
    assert.deepEqual([...OUTLOOK_LAYERS], [
      "observed_fact",
      "measured_trend",
      "signal",
      "assessment",
      "forecast",
    ]);
    assert.ok(doc.observationWindow?.start);
    assert.ok(doc.baseline);
    assert.ok(Array.isArray(doc.supportingIndicators));
    assert.ok(Array.isArray(doc.contradictingIndicators));
    assert.ok(doc.assumptions.length >= 3);
    assert.ok(doc.confidence.label);
    assert.ok(doc.provenance.rulesetHash);
    assert.ok(doc.provenance.modelVersion);
    assert.ok(doc.expiresAt);
    assert.ok(doc.backtest.status);
  });

  it("does not publish a forecast when metric gates fail", () => {
    const doc = buildOutlook(sparseQuery, "comparable_basket_price_index");
    assert.equal(doc.eligibility.eligible, false);
    assert.equal(doc.forecast, null);
    assert.equal(doc.publicationState, "insufficient_evidence");
    assert.equal(doc.confidence.label, "insufficient");
    const refused = refuseForecastPublication({ outlook: doc, source: "ruleset" });
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.code, "insufficient_evidence");
    const view = publicOutlookEligibilityView(doc);
    assert.equal(view.forecastPublished, false);
    assert.equal(view.insufficientEvidence, true);
    assert.equal("forecast" in view && (view as { forecast?: unknown }).forecast, false);
  });

  it("never publishes AI-generated forecasts even when gates pass", () => {
    const doc = buildOutlook(denseQuery, "provider_count_by_country");
    const refused = refuseForecastPublication({ outlook: doc, source: "ai" });
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.code, "ai_forecast_forbidden");
  });

  it("records observation window, baseline, and backtest status on eligible series", () => {
    const doc = buildOutlook(denseQuery, "provider_count_by_country");
    assert.equal(doc.observationWindow?.start, LONGITUDINAL_WINDOW.start);
    assert.equal(doc.baseline?.period.key, "2025-01");
    assert.ok(["pass", "fail", "insufficient"].includes(doc.backtest.status));
    assert.ok(doc.observedFact.points.length > 0);
    assert.equal(doc.measuredTrend.layer, "measured_trend");
    if (doc.eligibility.eligible && doc.backtest.status === "pass") {
      assert.ok(doc.forecast);
      assert.equal(doc.forecast?.layer, "forecast");
      assert.equal(doc.forecast?.method, "ruleset_ols");
      assert.equal(doc.publicationState, "not_published");
    } else {
      assert.equal(doc.forecast, null);
      assert.equal(doc.publicationState, "insufficient_evidence");
    }
  });

  it("walk-forward backtest is deterministic", () => {
    const doc = buildOutlook(denseQuery, "comparable_basket_price_index");
    const again = backtestTrend(doc.observedFact.points);
    assert.deepEqual(again, doc.backtest);
  });

  it("keeps facts and trends visible but withholds forecast when backtest fails", () => {
    const doc = buildOutlook(
      {
        facts: oscillatingPriceFacts(),
        window: { ...LONGITUDINAL_WINDOW },
        countryCode: "ID",
        dataRevision: LONGITUDINAL_DATA_REVISION,
      },
      "comparable_basket_price_index"
    );
    assert.equal(doc.eligibility.eligible, true);
    assert.ok(["fail", "insufficient"].includes(doc.backtest.status));
    assert.equal(doc.forecast, null);
    assert.equal(doc.publicationState, "insufficient_evidence");
    assert.equal(doc.confidence.label, "insufficient");
    assert.ok(doc.observedFact.points.length >= 12);
    assert.equal(doc.observedFact.layer, "observed_fact");
    assert.equal(doc.measuredTrend.layer, "measured_trend");
    const view = publicOutlookEligibilityView(doc);
    assert.equal(view.insufficientEvidence, true);
    assert.equal(view.forecastPublished, false);
  });

  it("emits an OLS residual interval only after a passing backtest", () => {
    const doc = buildOutlook(
      {
        facts: monotonicPriceFacts(),
        window: { ...LONGITUDINAL_WINDOW },
        countryCode: "ID",
        dataRevision: LONGITUDINAL_DATA_REVISION,
      },
      "comparable_basket_price_index"
    );
    assert.equal(doc.eligibility.eligible, true);
    assert.equal(doc.backtest.status, "pass");
    assert.ok(doc.forecast);
    assert.equal(doc.forecast?.method, "ruleset_ols");
    const last = doc.observedFact.points.filter((p) => p.value != null).at(-1)!;
    const arbitrary = Math.max(Math.abs(last.value as number) * 0.1, 0.5);
    const half = doc.forecast!.interval[1] - doc.forecast!.pointEstimate;
    assert.notEqual(half, arbitrary);
    assert.ok(Math.abs(half - (doc.forecast!.pointEstimate - doc.forecast!.interval[0])) < 1e-9);
    assert.ok(doc.forecast!.interval[0] <= doc.forecast!.pointEstimate);
    assert.ok(doc.forecast!.pointEstimate <= doc.forecast!.interval[1]);
  });
});
