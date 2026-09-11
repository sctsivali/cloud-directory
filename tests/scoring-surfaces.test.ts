import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sortMetricLabel, type SortMetricId } from "../packages/domain/src/scoring/descriptors.ts";
import {
  constraintsFromNeeds,
  reconcileCompareIds,
  recommendWizardRows,
  type NeedsState,
  type Rankable,
} from "../web/src/lib/needs.ts";

const baseNeeds: NeedsState = {
  sector: "public",
  workloads: ["publicsvc"],
  impact: "critical",
  data: "sensitive",
  countries: ["Brunei"],
  priorities: ["location"],
  extras: { residency: "must_in_country", hall: "need_hall", entity: "local_entity" },
};

function row(partial: Partial<Rankable> & Pick<Rankable, "id" | "name">): Rankable {
  return {
    hq_country: null,
    is_local_asean: true,
    sov_score: 10,
    oss_score: 10,
    conf_score: 10,
    min_price: 9,
    loc_count: 1,
    max_vcpu: 2,
    max_ram: 4,
    ...partial,
  };
}

describe("wizard metric labels", () => {
  it("uses the shared descriptor for every sort key, not a frozen SOV label", () => {
    const sorts: SortMetricId[] = ["sov", "oss", "conf", "cost", "cover", "perf"];
    const labels = Object.fromEntries(
      sorts.map((sort) => [sort, sortMetricLabel(sort, "en", "from USD/bln")])
    );
    assert.equal(labels.sov, "Control & residency indicator");
    assert.equal(labels.oss, "Open-technology indicator");
    assert.equal(labels.conf, "Evidence quality");
    assert.equal(labels.cost, "from USD/bln");
    assert.equal(labels.cover, "DC location count");
    assert.equal(labels.perf, "Largest vCPU");
    assert.notEqual(labels.oss, labels.sov);
    assert.notEqual(labels.conf, labels.sov);
  });
});

describe("stale compare selection", () => {
  it("drops ids that are no longer in the current row set", () => {
    assert.deepEqual(reconcileCompareIds(["gone", "keep", "also-gone"], ["keep", "other"]), ["keep"]);
  });
});

describe("wizard hard constraints without silent relaxation", () => {
  it("does not widen a one-country requirement when only one HQ matches", () => {
    const rows = [
      row({ id: "solo-brunei", name: "Brunei Solo", hq_country: "Brunei", sov_score: 40 }),
      row({ id: "local-packages", name: "Nusantara", hq_country: "Indonesia", sov_score: 100 }),
      row({ id: "multi-region", name: "Multi", hq_country: "Singapore", sov_score: 90 }),
    ];
    const constraints = constraintsFromNeeds(baseNeeds);
    assert.equal(constraints.country, "Brunei");
    assert.equal(constraints.residencyCountry, "Brunei");
    assert.equal(constraints.requireNamedFacility, true);
    assert.equal(constraints.legalCountry, "Brunei");
    const result = recommendWizardRows(rows, baseNeeds);
    assert.equal(result.engine, "legacy-fallback");
    assert.ok(result.fallbackLabel?.toLowerCase().includes("legacy"));
    assert.deepEqual(
      result.eligible.map((r) => r.id),
      []
    );
    assert.ok(result.needs_verification.every((r) => r.id === "solo-brunei" || r.hq_country === "Brunei"));
    assert.ok(!result.needs_verification.some((r) => r.id === "local-packages"));
    assert.ok(result.excluded.some((r) => r.id === "local-packages"));
  });
});
