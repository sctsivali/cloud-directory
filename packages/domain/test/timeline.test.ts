import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { requireRegisteredIso2 } from "../src/intelligence/countries.ts";
import { INTELLIGENCE_RULESET_HASH } from "../src/intelligence/methodology.ts";
import { buildCountryTimeline, buildProviderTimeline } from "../src/intelligence/timeline.ts";
import { LONGITUDINAL_DATA_REVISION, LONGITUDINAL_WINDOW, longitudinalFacts } from "./intelligence-fixtures.ts";

const facts = longitudinalFacts();
const window = { ...LONGITUDINAL_WINDOW };

describe("provider and country timelines", () => {
  it("lists verified provider events in observation order with provenance", () => {
    const doc = buildProviderTimeline({
      facts,
      window,
      providerId: "prov-a",
      dataRevision: LONGITUDINAL_DATA_REVISION,
    });
    assert.equal(doc.kind, "provider_timeline");
    assert.equal(doc.providerId, "prov-a");
    assert.equal(doc.methodologyHash, INTELLIGENCE_RULESET_HASH);
    assert.equal(doc.dataRevision, LONGITUDINAL_DATA_REVISION);
    assert.ok(doc.events.length > 0);
    for (let i = 1; i < doc.events.length; i += 1) {
      assert.ok(doc.events[i]!.observedAt >= doc.events[i - 1]!.observedAt);
    }
    assert.equal(doc.events.some((e) => e.verificationState === "pending"), false);
    assert.equal(doc.events.some((e) => e.providerId && e.providerId !== "prov-a"), false);
    const conflict = doc.events.find((e) => e.receiptId === "r-a-conflict");
    assert.equal(conflict?.conflict, true);
    const stale = doc.events.find((e) => e.receiptId === "r-a-stale-claim");
    assert.equal(stale?.stale, true);
  });

  it("builds a country timeline from the ISO registry only", () => {
    const indonesia = requireRegisteredIso2("ID");
    const doc = buildCountryTimeline({
      facts,
      window,
      countryCode: indonesia.iso2,
      dataRevision: LONGITUDINAL_DATA_REVISION,
    });
    assert.equal(doc.kind, "country_timeline");
    assert.equal(doc.countryCode, "ID");
    assert.equal(doc.country?.nameEn, "Indonesia");
    assert.ok(doc.events.every((e) => e.countryCode === "ID"));
    assert.equal(doc.events.some((e) => e.countryCode === "SG"), false);
  });

  it("rejects unknown country codes", () => {
    assert.throws(
      () =>
        buildCountryTimeline({
          facts,
          window,
          countryCode: "ZZ",
        }),
      /unregistered/
    );
  });
});
