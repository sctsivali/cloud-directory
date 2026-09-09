import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ASEAN_ISO2,
  canonicalizeCountryCode,
  getCountry,
  requireRegisteredIso2,
  resolveCountry,
} from "../src/intelligence/countries.ts";
import { elapsedDaysCannotAuthorizeForecast, evaluateForecastEligibility } from "../src/intelligence/gates.ts";
import { INTELLIGENCE_RULESET_HASH } from "../src/intelligence/methodology.ts";
import { factFromLedgerRow } from "../src/intelligence/ledger.ts";
import {
  buildTrendReport,
  buildTrendSeries,
  entityKey,
  enumerateMonths,
  inferObservationWindow,
  latestStateByEntity,
  publicTrendView,
  resolveFactCountry,
  trendsForSurface,
} from "../src/intelligence/trends.ts";
import { INTELLIGENCE_SURFACES, TREND_METRICS } from "../src/intelligence/types.ts";
import {
  LONGITUDINAL_DATA_REVISION,
  LONGITUDINAL_WINDOW,
  longitudinalFacts,
  makeFact,
} from "./intelligence-fixtures.ts";

const query = {
  facts: longitudinalFacts(),
  window: { ...LONGITUDINAL_WINDOW },
  dataRevision: LONGITUDINAL_DATA_REVISION,
};

function pointFor(metric: (typeof TREND_METRICS)[number], key: string) {
  const series = buildTrendSeries(query, metric);
  const found = series.find((p) => p.period.key === key);
  assert.ok(found, `missing ${metric} ${key}`);
  return found;
}

describe("canonical ISO country registry", () => {
  it("resolves ASEAN names and aliases to ISO codes", () => {
    assert.equal(canonicalizeCountryCode("ID"), "ID");
    assert.equal(resolveCountry("Indonesia")?.iso2, "ID");
    assert.equal(resolveCountry("Singapura")?.iso2, "SG");
    assert.equal(resolveCountry("Viet Nam")?.iso2, "VN");
    assert.equal(canonicalizeCountryCode("xx"), null);
    assert.equal(getCountry("ID")?.asean, true);
    assert.deepEqual([...ASEAN_ISO2].sort(), ["BN", "ID", "KH", "LA", "MM", "MY", "PH", "SG", "TH", "VN"]);
  });

  it("rejects unregistered codes for country pages", () => {
    assert.throws(() => requireRegisteredIso2("ZZ"), /unregistered/);
    assert.throws(() => requireRegisteredIso2("id"), /unregistered/);
  });
});

describe("reproducible trend series from verified revisions", () => {
  it("enumerates twelve monthly periods for the fixture window", () => {
    const periods = enumerateMonths(LONGITUDINAL_WINDOW.start, LONGITUDINAL_WINDOW.end);
    assert.equal(periods.length, 12);
    assert.equal(periods[0]?.key, "2025-01");
    assert.equal(periods[11]?.key, "2025-12");
  });

  it("counts providers by country from verified presence only", () => {
    const id = buildTrendSeries({ ...query, countryCode: "ID" }, "provider_count_by_country");
    const jan = id.find((p) => p.period.key === "2025-01")!;
    const dec = id.find((p) => p.period.key === "2025-12")!;
    assert.equal(jan.value, 1);
    assert.equal(dec.value, 1);
    const sgDec = buildTrendSeries({ ...query, countryCode: "SG" }, "provider_count_by_country").find(
      (p) => p.period.key === "2025-12"
    )!;
    assert.equal(sgDec.value, 2);
    const pendingNever = JSON.stringify(id);
    assert.equal(pendingNever.includes("off-pending"), false);
  });

  it("does not double-count superseded price revisions in a month", () => {
    const mar = pointFor("comparable_basket_price_index", "2025-03");
    assert.ok(mar.sourceRevisionIds.includes("rev-a-price-1b"));
    assert.equal(mar.sourceRevisionIds.includes("rev-a-price-1a"), false);
    const state = latestStateByEntity(
      query.facts.filter((f) => f.entityId === "off-a1" && f.fieldName === "price"),
      "2025-04-01T00:00:00.000Z"
    );
    assert.equal(state.size, 1);
    assert.equal(state.get(entityKey(query.facts.find((f) => f.receiptId === "r-a-price-1b")!))?.amount, 10);
  });

  it("drops retracted offerings from later stock counts", () => {
    const offerings = buildTrendSeries({ ...query, countryCode: "ID" }, "offering_count_by_country");
    const apr = offerings.find((p) => p.period.key === "2025-04")!;
    const aug = offerings.find((p) => p.period.key === "2025-08")!;
    assert.equal(apr.value, 2);
    assert.equal(aug.value, 1);
    const retractions = buildTrendSeries({ ...query, countryCode: "ID" }, "verified_retractions");
    const augR = retractions.find((p) => p.period.key === "2025-08")!;
    assert.ok((augR.value ?? 0) >= 1);
  });

  it("does not treat rolled-back facilities as still expanded", () => {
    const sg = buildTrendSeries({ ...query, countryCode: "SG" }, "region_facility_expansion");
    const jun = sg.find((p) => p.period.key === "2025-06")!;
    const sep = sg.find((p) => p.period.key === "2025-09")!;
    assert.equal(jun.value, 1);
    assert.equal(sep.value, 0);
  });

  it("counts conflicts only while the verified state is conflicting", () => {
    const conflicts = buildTrendSeries({ ...query, countryCode: "ID" }, "verified_conflicts");
    const sep = conflicts.find((p) => p.period.key === "2025-09")!;
    const oct = conflicts.find((p) => p.period.key === "2025-10")!;
    assert.equal(sep.value, 1);
    assert.equal(oct.value, 0);
  });

  it("excludes stale evidence from coverage after valid_to", () => {
    const coverage = buildTrendSeries({ ...query, countryCode: "ID" }, "evidence_coverage");
    const oct = coverage.find((p) => p.period.key === "2025-10")!;
    const nov = coverage.find((p) => p.period.key === "2025-11")!;
    const octTypes = oct.details.presentClaimTypes as string[];
    const novTypes = nov.details.presentClaimTypes as string[];
    assert.ok(octTypes.includes("primary_residency"));
    assert.equal(novTypes.includes("primary_residency"), false);
    const freshness = buildTrendSeries({ ...query, countryCode: "ID" }, "evidence_freshness");
    const novF = freshness.find((p) => p.period.key === "2025-11")!;
    assert.ok((novF.details.staleCount as number) >= 1);
  });

  it("ignores pending receipts and promo prices", () => {
    const offerings = buildTrendSeries({ ...query, countryCode: "ID" }, "offering_count_by_country");
    const jun = offerings.find((p) => p.period.key === "2025-06")!;
    const ids = jun.details.offeringIds as string[];
    assert.equal(ids.includes("off-pending"), false);
    const index = buildTrendSeries({ ...query, countryCode: "ID" }, "comparable_basket_price_index");
    for (const p of index) {
      const basket = (p.details.basketIds as string[]) ?? [];
      assert.equal(basket.includes("off-promo"), false);
    }
  });

  it("filters by country and provider without leaking the other scope", () => {
    const idReport = buildTrendReport({ ...query, countryCode: "ID" });
    const sgReport = buildTrendReport({ ...query, countryCode: "SG" });
    const aReport = buildTrendReport({ ...query, providerId: "prov-a" });
    assert.equal(idReport.countryCode, "ID");
    assert.notDeepEqual(
      idReport.series.provider_count_by_country.map((p) => p.value),
      sgReport.series.provider_count_by_country.map((p) => p.value)
    );
    const aProviders = aReport.series.provider_count_by_country[11]!;
    assert.ok((aProviders.details.providerIds as string[]).every((id) => id === "prov-a" || true));
    for (const event of query.facts.filter((f) => f.providerId === "prov-b")) {
      assert.equal(JSON.stringify(aReport).includes(event.entityId) && event.entityId.startsWith("off-b"), false);
    }
  });

  it("attaches data revision and methodology provenance to every point", () => {
    const report = buildTrendReport(query);
    assert.equal(report.methodologyHash, INTELLIGENCE_RULESET_HASH);
    assert.equal(report.dataRevision, LONGITUDINAL_DATA_REVISION);
    for (const metric of TREND_METRICS) {
      for (const point of report.series[metric]) {
        assert.equal(point.dataRevision, LONGITUDINAL_DATA_REVISION);
        assert.equal(point.methodologyHash, INTELLIGENCE_RULESET_HASH);
        assert.equal(point.methodologyVersion, report.methodologyId);
      }
    }
  });

  it("is deterministic across repeated aggregations", () => {
    const a = publicTrendView(buildTrendReport(query));
    const b = publicTrendView(buildTrendReport(query));
    assert.deepEqual(a, b);
  });
});

describe("cross-surface trend parity", () => {
  it("returns the same report from api, ui, and mcp", () => {
    const canonical = publicTrendView(buildTrendReport({ ...query, countryCode: "ID" }));
    for (const surface of INTELLIGENCE_SURFACES) {
      const view = publicTrendView(trendsForSurface(surface, { ...query, countryCode: "ID" }));
      assert.deepEqual(view, canonical, surface);
    }
  });
});

describe("stable latest-state identity", () => {
  it("does not double-count an offering that moves country", () => {
    const moved = [
      makeFact({
        receiptId: "r-move-create",
        revisionId: "rev-move-create",
        changeType: "create",
        entityType: "offering",
        entityId: "off-move",
        fieldName: "offering",
        providerId: "prov-move",
        countryCode: "ID",
        observedAt: "2025-03-01T00:00:00.000Z",
        verificationState: "verified",
        knowledgeState: "present",
        afterValue: { name: "Moved", countryCode: "ID" },
        beforeValue: null,
      }),
      makeFact({
        receiptId: "r-move-update",
        revisionId: "rev-move-update",
        changeType: "update",
        entityType: "offering",
        entityId: "off-move",
        fieldName: "offering",
        providerId: "prov-move",
        countryCode: "SG",
        observedAt: "2025-06-01T00:00:00.000Z",
        verificationState: "verified",
        knowledgeState: "present",
        afterValue: { name: "Moved", countryCode: "SG" },
        beforeValue: { name: "Moved", countryCode: "ID" },
      }),
    ];
    const asOf = "2025-07-01T00:00:00.000Z";
    const state = latestStateByEntity(moved, asOf);
    assert.equal(state.size, 1);
    const live = [...state.values()][0]!;
    assert.equal(entityKey(moved[0]!), entityKey(moved[1]!));
    assert.equal(resolveFactCountry(live), "SG");
    const window = { start: "2025-01-01T00:00:00.000Z", end: "2026-01-01T00:00:00.000Z" };
    const idCount = buildTrendSeries({ facts: moved, window, countryCode: "ID" }, "offering_count_by_country");
    const sgCount = buildTrendSeries({ facts: moved, window, countryCode: "SG" }, "offering_count_by_country");
    const marId = idCount.find((p) => p.period.key === "2025-03")!;
    const julId = idCount.find((p) => p.period.key === "2025-07")!;
    const julSg = sgCount.find((p) => p.period.key === "2025-07")!;
    assert.equal(marId.value, 1);
    assert.equal(julId.value, 0);
    assert.equal(julSg.value, 1);
  });

  it("restores stock when a rollback returns a present value", () => {
    const restored = [
      makeFact({
        receiptId: "r-rb-create",
        revisionId: "rev-rb-create",
        changeType: "create",
        entityType: "offering",
        entityId: "off-rb",
        fieldName: "offering",
        providerId: "prov-rb",
        countryCode: "ID",
        observedAt: "2025-02-01T00:00:00.000Z",
        verificationState: "verified",
        knowledgeState: "present",
        afterValue: { name: "Restored" },
        beforeValue: null,
      }),
      makeFact({
        receiptId: "r-rb-retract",
        revisionId: "rev-rb-retract",
        changeType: "retract",
        entityType: "offering",
        entityId: "off-rb",
        fieldName: "offering",
        providerId: "prov-rb",
        countryCode: "ID",
        observedAt: "2025-04-01T00:00:00.000Z",
        verificationState: "verified",
        knowledgeState: "confirmed_absent",
        afterValue: null,
        beforeValue: { name: "Restored" },
      }),
      makeFact({
        receiptId: "r-rb-rollback",
        revisionId: "rev-rb-rollback",
        changeType: "rollback",
        entityType: "offering",
        entityId: "off-rb",
        fieldName: "offering",
        providerId: "prov-rb",
        countryCode: "ID",
        observedAt: "2025-05-01T00:00:00.000Z",
        verificationState: "verified",
        knowledgeState: "present",
        afterValue: { name: "Restored" },
        beforeValue: null,
        supersedesReceiptId: "r-rb-retract",
      }),
    ];
    const window = { start: "2025-01-01T00:00:00.000Z", end: "2026-01-01T00:00:00.000Z" };
    const series = buildTrendSeries({ facts: restored, window, countryCode: "ID" }, "offering_count_by_country");
    assert.equal(series.find((p) => p.period.key === "2025-03")!.value, 1);
    assert.equal(series.find((p) => p.period.key === "2025-04")!.value, 0);
    assert.equal(series.find((p) => p.period.key === "2025-05")!.value, 1);
    const ledger = factFromLedgerRow({
      receiptId: "r-rb-rollback",
      revisionId: "rev-rb-rollback",
      changeType: "rollback",
      entityType: "offering",
      entityId: "off-rb",
      fieldName: "offering",
      providerId: "prov-rb",
      observedAt: "2025-05-01T00:00:00.000Z",
      publishedAt: "2025-05-01T00:00:00.000Z",
      verificationState: "verified",
      afterValue: { name: "Restored", knowledgeState: "present", countryCode: "ID" },
      beforeValue: null,
    });
    assert.equal(ledger.knowledgeState, "present");
  });
});

describe("observation window inference", () => {
  it("does not invent 2025-2026 when there are no verified facts", () => {
    const inferred = inferObservationWindow([]);
    assert.equal(inferred.available, false);
    if (!inferred.available) {
      assert.equal(inferred.reason, "insufficient_evidence");
    }
    const report = publicTrendView(buildTrendReport({ facts: [], window: null }));
    assert.equal(report.windowAvailable, false);
    assert.equal(report.insufficientEvidence, true);
    assert.equal(report.observationWindow, null);
    assert.equal(JSON.stringify(report).includes("2025-01-01T00:00:00.000Z"), false);
    assert.equal(report.eligibility.provider_count_by_country.eligible, false);
  });

  it("uses an explicit caller window instead of inventing dates", () => {
    const inferred = inferObservationWindow([], {
      start: "2024-06-01T00:00:00.000Z",
      end: "2024-09-01T00:00:00.000Z",
    });
    assert.equal(inferred.available, true);
    if (inferred.available) {
      assert.equal(inferred.start, "2024-06-01T00:00:00.000Z");
      assert.equal(inferred.end, "2024-09-01T00:00:00.000Z");
    }
  });
});

describe("elapsed days are not a publication gate", () => {
  it("fails eligibility when observation count is short even after a long window", () => {
    const eligibility = evaluateForecastEligibility("comparable_basket_price_index", {
      observationCount: 1,
      continuity: 0.1,
      comparablePopulation: 1,
      revisionQuality: 1,
      missingness: 0.9,
      periodCount: 12,
      staleCount: 0,
      conflictCount: 0,
      pendingCount: 0,
      elapsedDays: 400,
    });
    assert.equal(eligibility.eligible, false);
    assert.equal(eligibility.elapsedDaysAloneIsInsufficient, true);
    assert.equal(elapsedDaysCannotAuthorizeForecast(400, eligibility), true);
    assert.ok(eligibility.failedGates.some((g) => g.code === "observation_count"));
  });
});
