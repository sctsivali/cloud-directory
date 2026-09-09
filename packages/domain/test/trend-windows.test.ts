import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_TREND_FACTS,
  MAX_TREND_WINDOW_MONTHS,
  buildTrendReport,
  enumerateMonths,
  guardTrendQuery,
  inferObservationWindow,
  validateObservationWindow,
} from "../src/intelligence/trends.ts";
import { longitudinalFacts, LONGITUDINAL_WINDOW } from "./intelligence-fixtures.ts";

describe("S4 trend window validation", () => {
  it("accepts canonical timestamps with start before end within the month bound", () => {
    const ok = validateObservationWindow(LONGITUDINAL_WINDOW.start, LONGITUDINAL_WINDOW.end);
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.months, 12);
    const periods = enumerateMonths(LONGITUDINAL_WINDOW.start, LONGITUDINAL_WINDOW.end);
    assert.equal(periods.length, 12);
  });

  it("rejects non-canonical timestamps, inverted windows, and unbounded ranges before enumeration", () => {
    const nonCanonical = validateObservationWindow("2025-01-01", "2026-01-01T00:00:00.000Z");
    assert.equal(nonCanonical.ok, false);
    const inverted = validateObservationWindow("2026-01-01T00:00:00.000Z", "2025-01-01T00:00:00.000Z");
    assert.equal(inverted.ok, false);
    const equal = validateObservationWindow("2025-01-01T00:00:00.000Z", "2025-01-01T00:00:00.000Z");
    assert.equal(equal.ok, false);
    const huge = validateObservationWindow("2000-01-01T00:00:00.000Z", "2100-01-01T00:00:00.000Z");
    assert.equal(huge.ok, false);
    if (huge.ok === false) assert.equal(huge.code, "window_too_large");
    assert.throws(() => enumerateMonths("2000-01-01T00:00:00.000Z", "2100-01-01T00:00:00.000Z"), /window/i);
    assert.ok(MAX_TREND_WINDOW_MONTHS <= 120);
    assert.ok(MAX_TREND_FACTS <= 10_000);
  });

  it("guards MCP/API query args including page and result limits", () => {
    const ok = guardTrendQuery({
      windowStart: LONGITUDINAL_WINDOW.start,
      windowEnd: LONGITUDINAL_WINDOW.end,
      limit: 20,
      page: 1,
    });
    assert.equal(ok.ok, true);
    const badTs = guardTrendQuery({ windowStart: "yesterday", windowEnd: LONGITUDINAL_WINDOW.end });
    assert.equal(badTs.ok, false);
    const badPage = guardTrendQuery({ limit: 99999, page: 0 });
    assert.equal(badPage.ok, false);
    const onlyStart = guardTrendQuery({ windowStart: LONGITUDINAL_WINDOW.start });
    assert.equal(onlyStart.ok, false);
  });

  it("does not enumerate an inferred window that exceeds the bound", () => {
    const facts = longitudinalFacts();
    const inferred = inferObservationWindow(facts);
    assert.equal(inferred.available, true);
    const oversized = inferObservationWindow(facts, {
      start: "1900-01-01T00:00:00.000Z",
      end: "2100-01-01T00:00:00.000Z",
    });
    assert.equal(oversized.available, false);
    const report = buildTrendReport({
      facts,
      window: { start: "1900-01-01T00:00:00.000Z", end: "2100-01-01T00:00:00.000Z" },
    });
    assert.equal(report.windowAvailable, false);
    assert.equal(report.insufficientEvidence, true);
  });
});
