import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CURRENT_METHODOLOGY } from "../src/scoring/methodology.ts";
import {
  bindDisplayedScore,
  displayedScoreFromCanonicalRun,
  LEGACY_ALGORITHM_VERSION,
  LEGACY_DATA_REVISION,
  LEGACY_FALLBACK_LABEL,
  LEGACY_METHODOLOGY_ID,
  LEGACY_RULESET_HASH,
  scoringRunIdentity,
  selectLatestMatchingScoringRun,
  type ScoreComponentRow,
  type ScoringRunIdentity,
  type ScoringRunRow,
} from "../src/scoring/provenance.ts";

const IDENTITY: ScoringRunIdentity = {
  offeringId: "off-a",
  deploymentId: "dep-a",
  dataRevision: "rev-new",
  methodologyId: CURRENT_METHODOLOGY.id,
};

const SQL = { sov: 11, oss: 22, conf: 33 };

function run(partial: Partial<ScoringRunRow> & Pick<ScoringRunRow, "id">): ScoringRunRow {
  return {
    offeringId: IDENTITY.offeringId,
    deploymentId: IDENTITY.deploymentId,
    providerId: "prov-a",
    methodologyId: IDENTITY.methodologyId,
    algorithmVersion: CURRENT_METHODOLOGY.algorithmVersion,
    rulesetHash: CURRENT_METHODOLOGY.rulesetHash,
    dataRevision: IDENTITY.dataRevision,
    engine: "canonical",
    composite: 0.71,
    rankingLowerBound: 0.55,
    uncertainty: 0.2,
    createdAt: "2026-02-01T00:00:00.000Z",
    ...partial,
  };
}

function component(
  scoringRunId: string,
  dimension: string,
  value: number | null,
  extras: Partial<ScoreComponentRow> = {}
): ScoreComponentRow {
  return {
    scoringRunId,
    dimension,
    knowledgeState: value == null ? "unknown" : "present",
    value,
    weight: 10,
    uncertainty: value == null ? 1 : 0.1,
    reasonCodes: value == null ? ["UNKNOWN"] : ["PRESENT"],
    ...extras,
  };
}

function canonicalComponents(runId: string, raw: number): ScoreComponentRow[] {
  return [
    component(runId, "primary_data_residency", raw),
    component(runId, "backup_residency", raw),
    component(runId, "metadata_control_plane_residency", raw),
    component(runId, "contracting_entity_legal_control", raw),
    component(runId, "open_technology_portability", raw / 2),
    component(runId, "evidence_quality", raw / 4),
    component(runId, "evidence_coverage", raw / 4),
  ];
}

describe("L6 same scoring value and provenance", () => {
  it("binds canonical numbers and engine metadata to the exact latest matching scoring_run row", () => {
    const stale = run({
      id: "run-old",
      composite: 0.11,
      rankingLowerBound: 0.09,
      uncertainty: 0.9,
      createdAt: "2026-01-01T00:00:00.000Z",
      algorithmVersion: "0.9.0",
      rulesetHash: "aa".repeat(32),
    });
    const latest = run({ id: "run-new", composite: 0.88, rankingLowerBound: 0.7, uncertainty: 0.12 });
    const selected = selectLatestMatchingScoringRun([stale, latest], IDENTITY);
    assert.equal(selected?.id, "run-new");
    const displayed = bindDisplayedScore({
      legacySql: SQL,
      runs: [stale, latest],
      components: [...canonicalComponents("run-old", 0.1), ...canonicalComponents("run-new", 0.8)],
      identity: IDENTITY,
    });
    assert.equal(displayed.engine, "canonical");
    assert.equal(displayed.scoringRunId, "run-new");
    assert.equal(displayed.offeringId, IDENTITY.offeringId);
    assert.equal(displayed.deploymentId, IDENTITY.deploymentId);
    assert.equal(displayed.dataRevision, IDENTITY.dataRevision);
    assert.equal(displayed.methodologyId, IDENTITY.methodologyId);
    assert.equal(displayed.algorithmVersion, CURRENT_METHODOLOGY.algorithmVersion);
    assert.equal(displayed.rulesetHash, CURRENT_METHODOLOGY.rulesetHash);
    assert.equal(displayed.composite, 0.88);
    assert.equal(displayed.rankingLowerBound, 0.7);
    assert.equal(displayed.uncertainty, 0.12);
    assert.equal(displayed.fallbackLabel, null);
    assert.equal(displayed.sov_score, 80);
    assert.equal(displayed.oss_score, 40);
    assert.equal(displayed.conf_score, 20);
    assert.notEqual(displayed.sov_score, SQL.sov);
    assert.notEqual(displayed.oss_score, SQL.oss);
    assert.notEqual(displayed.conf_score, SQL.conf);
    assert.ok(displayed.components.every((row) => row.scoringRunId === "run-new"));
    assert.deepEqual(scoringRunIdentity(latest), IDENTITY);
  });

  it("rejects stale or mismatched revision, offering, deployment, and methodology mixing", () => {
    const matching = run({ id: "run-new", composite: 0.88 });
    const staleRevision = run({
      id: "run-stale",
      dataRevision: "rev-old",
      composite: 0.99,
      createdAt: "2026-03-01T00:00:00.000Z",
    });
    const otherOffering = run({ id: "run-off", offeringId: "off-b", composite: 0.42 });
    const otherDeployment = run({ id: "run-dep", deploymentId: "dep-b", composite: 0.43 });
    const otherMethodology = run({
      id: "run-meth",
      methodologyId: "other-methodology",
      composite: 0.44,
    });
    const mixed = [
      matching,
      staleRevision,
      otherOffering,
      otherDeployment,
      otherMethodology,
    ];
    const components = [
      ...canonicalComponents("run-new", 0.8),
      ...canonicalComponents("run-stale", 0.99),
      ...canonicalComponents("run-off", 0.42),
      ...canonicalComponents("run-dep", 0.43),
      ...canonicalComponents("run-meth", 0.44),
    ];

    for (const identity of [
      { ...IDENTITY, dataRevision: "rev-old" },
      { ...IDENTITY, offeringId: "off-b" },
      { ...IDENTITY, deploymentId: "dep-b" },
      { ...IDENTITY, methodologyId: "other-methodology" },
    ] satisfies ScoringRunIdentity[]) {
      const displayed = bindDisplayedScore({
        legacySql: SQL,
        runs: mixed,
        components,
        identity: IDENTITY,
      });
      assert.equal(displayed.scoringRunId, "run-new", JSON.stringify(identity));
      assert.equal(displayed.dataRevision, "rev-new");
      assert.equal(displayed.composite, 0.88);
      assert.notEqual(displayed.composite, 0.99);
    }

    const staleRequest = bindDisplayedScore({
      legacySql: SQL,
      runs: mixed,
      components,
      identity: { ...IDENTITY, dataRevision: "rev-missing" },
    });
    assert.equal(staleRequest.engine, "legacy-fallback");
    assert.equal(staleRequest.scoringRunId, null);
    assert.equal(staleRequest.sov_score, SQL.sov);
    assert.equal(staleRequest.oss_score, SQL.oss);
    assert.equal(staleRequest.conf_score, SQL.conf);
    assert.equal(staleRequest.methodologyId, LEGACY_METHODOLOGY_ID);
    assert.notEqual(staleRequest.methodologyId, CURRENT_METHODOLOGY.id);
    assert.notEqual(staleRequest.rulesetHash, CURRENT_METHODOLOGY.rulesetHash);
    assert.notEqual(staleRequest.algorithmVersion, CURRENT_METHODOLOGY.algorithmVersion);
    assert.equal(staleRequest.dataRevision, LEGACY_DATA_REVISION);
  });

  it("ignores score_components that do not belong to the selected scoring_run id", () => {
    const latest = run({ id: "run-new", composite: 0.5 });
    const displayed = displayedScoreFromCanonicalRun(latest, [
      ...canonicalComponents("run-new", 0.4),
      ...canonicalComponents("run-foreign", 1),
    ]);
    assert.equal(displayed?.scoringRunId, "run-new");
    assert.equal(displayed?.sov_score, 40);
    assert.ok(displayed?.components.every((row) => row.scoringRunId === "run-new"));
    assert.equal(
      displayedScoreFromCanonicalRun(latest, canonicalComponents("run-foreign", 1)),
      null
    );
  });

  it("labels legacy SQL values as legacy-fallback with legacy methodology metadata only", () => {
    const canonicalRun = run({ id: "run-new" });
    const displayed = bindDisplayedScore({
      legacySql: SQL,
      runs: [canonicalRun],
      components: canonicalComponents("run-new", 0.8),
      identity: null,
    });
    assert.equal(displayed.engine, "legacy-fallback");
    assert.equal(displayed.scoringRunId, null);
    assert.equal(displayed.sov_score, 11);
    assert.equal(displayed.oss_score, 22);
    assert.equal(displayed.conf_score, 33);
    assert.equal(displayed.methodologyId, LEGACY_METHODOLOGY_ID);
    assert.equal(displayed.algorithmVersion, LEGACY_ALGORITHM_VERSION);
    assert.equal(displayed.rulesetHash, LEGACY_RULESET_HASH);
    assert.equal(displayed.dataRevision, LEGACY_DATA_REVISION);
    assert.equal(displayed.fallbackLabel, LEGACY_FALLBACK_LABEL);
    assert.ok(displayed.fallbackLabel?.toLowerCase().includes("legacy"));
    assert.notEqual(displayed.methodologyId, CURRENT_METHODOLOGY.id);
    assert.notEqual(displayed.rulesetHash, CURRENT_METHODOLOGY.rulesetHash);
    assert.notEqual(displayed.algorithmVersion, CURRENT_METHODOLOGY.algorithmVersion);
    assert.equal(displayed.composite, null);
    assert.deepEqual(displayed.components, []);
  });

  it("never attaches canonical metadata onto legacy SQL numbers", () => {
    const fallbackRun = run({ id: "run-fb", engine: "legacy-fallback", composite: 0.01 });
    const displayed = bindDisplayedScore({
      legacySql: SQL,
      runs: [fallbackRun],
      components: canonicalComponents("run-fb", 0.9),
      identity: IDENTITY,
    });
    assert.equal(displayed.engine, "legacy-fallback");
    assert.equal(displayed.sov_score, SQL.sov);
    assert.equal(displayed.methodologyId, LEGACY_METHODOLOGY_ID);
    assert.equal(displayed.algorithmVersion, LEGACY_ALGORITHM_VERSION);
    assert.notEqual(displayed.rulesetHash, CURRENT_METHODOLOGY.rulesetHash);
    assert.equal(displayed.fallbackLabel, LEGACY_FALLBACK_LABEL);
    assert.equal(displayed.scoringRunId, null);
  });
});
