import { sha256Hex, canonicalJson } from "./hash.ts";
import { LEGACY_FALLBACK_LABEL } from "./fallback.ts";
import { SORT_METRIC_DESCRIPTORS, type SortMetricId } from "./descriptors.ts";
import type { ScoreEngineKind } from "./types.ts";

export { LEGACY_FALLBACK_LABEL };

export const LEGACY_METHODOLOGY_ID = "legacy-sql-sov-oss-conf";
export const LEGACY_ALGORITHM_VERSION = "2026.08.18";
export const LEGACY_DATA_REVISION = "legacy-public-tables";

export const LEGACY_RULESET_HASH = sha256Hex(
  canonicalJson({
    id: LEGACY_METHODOLOGY_ID,
    algorithmVersion: LEGACY_ALGORITHM_VERSION,
    dimensions: ["SOV", "CONF", "OSS"],
  })
);

export const LATEST_SCORING_RUN_FOR_IDENTITY_SQL = `
SELECT DISTINCT ON (offering_id, deployment_id, data_revision, methodology_id)
  id,
  offering_id,
  deployment_id,
  provider_id,
  methodology_id,
  algorithm_version,
  ruleset_hash,
  data_revision,
  engine,
  composite::float AS composite,
  ranking_lower_bound::float AS ranking_lower_bound,
  uncertainty::float AS uncertainty,
  created_at
FROM scoring_runs
WHERE offering_id = $1
  AND deployment_id = $2
  AND data_revision = $3
  AND methodology_id = $4
ORDER BY offering_id, deployment_id, data_revision, methodology_id, created_at DESC, id DESC
`;

export const LATEST_SCORING_RUN_BY_PROVIDER_SQL = `
SELECT DISTINCT ON (provider_id)
  id,
  offering_id,
  deployment_id,
  provider_id,
  methodology_id,
  algorithm_version,
  ruleset_hash,
  data_revision,
  engine,
  composite::float AS composite,
  ranking_lower_bound::float AS ranking_lower_bound,
  uncertainty::float AS uncertainty,
  created_at
FROM scoring_runs
WHERE provider_id = ANY($1)
  AND methodology_id = $2
ORDER BY provider_id, created_at DESC, id DESC
`;

export const SCORE_COMPONENTS_FOR_RUNS_SQL = `
SELECT
  scoring_run_id,
  dimension,
  knowledge_state,
  value::float AS value,
  weight::float AS weight,
  uncertainty::float AS uncertainty,
  reason_codes
FROM score_components
WHERE scoring_run_id = ANY($1)
`;

export type ScoringRunIdentity = {
  offeringId: string;
  deploymentId: string;
  dataRevision: string;
  methodologyId: string;
};

export type ScoringRunRow = {
  id: string;
  offeringId: string | null;
  deploymentId: string | null;
  providerId: string | null;
  methodologyId: string;
  algorithmVersion: string;
  rulesetHash: string;
  dataRevision: string;
  engine: ScoreEngineKind;
  composite: number | null;
  rankingLowerBound: number | null;
  uncertainty: number;
  createdAt: string;
};

export type ScoreComponentRow = {
  scoringRunId: string;
  dimension: string;
  knowledgeState: string;
  value: number | null;
  weight: number;
  uncertainty: number;
  reasonCodes: string[];
};

export type LegacySqlScores = {
  sov: number;
  oss: number;
  conf: number;
};

export type DisplayedScore = {
  scoringRunId: string | null;
  offeringId: string | null;
  deploymentId: string | null;
  engine: ScoreEngineKind;
  methodologyId: string;
  algorithmVersion: string;
  rulesetHash: string;
  dataRevision: string;
  uncertainty: number | null;
  fallbackLabel: string | null;
  composite: number | null;
  rankingLowerBound: number | null;
  components: ScoreComponentRow[];
  sov_score: number;
  oss_score: number;
  conf_score: number;
};

export function scoringRunIdentity(run: ScoringRunRow): ScoringRunIdentity | null {
  if (!run.offeringId || !run.deploymentId || !run.dataRevision || !run.methodologyId) {
    return null;
  }
  return {
    offeringId: run.offeringId,
    deploymentId: run.deploymentId,
    dataRevision: run.dataRevision,
    methodologyId: run.methodologyId,
  };
}

function sameIdentity(run: ScoringRunRow, identity: ScoringRunIdentity): boolean {
  return (
    run.offeringId === identity.offeringId &&
    run.deploymentId === identity.deploymentId &&
    run.dataRevision === identity.dataRevision &&
    run.methodologyId === identity.methodologyId
  );
}

function byLatest(a: ScoringRunRow, b: ScoringRunRow): number {
  const byTime = b.createdAt.localeCompare(a.createdAt);
  if (byTime !== 0) return byTime;
  return b.id.localeCompare(a.id);
}

export function selectLatestScoringRun(runs: readonly ScoringRunRow[]): ScoringRunRow | null {
  if (runs.length === 0) return null;
  return [...runs].sort(byLatest)[0] ?? null;
}

export function selectLatestMatchingScoringRun(
  runs: readonly ScoringRunRow[],
  identity: ScoringRunIdentity
): ScoringRunRow | null {
  const matched = runs.filter((run) => sameIdentity(run, identity));
  return selectLatestScoringRun(matched);
}

function aliasScore(components: readonly ScoreComponentRow[], sort: SortMetricId): number {
  const dimensions = SORT_METRIC_DESCRIPTORS[sort].mapsTo ?? [];
  if (dimensions.length === 0) return 0;
  const known = dimensions
    .map((dimension) => components.find((row) => row.dimension === dimension))
    .filter((row): row is ScoreComponentRow => row != null && row.value != null);
  if (known.length === 0) return 0;
  const average = known.reduce((sum, row) => sum + Number(row.value), 0) / known.length;
  return Math.round(average <= 1 ? average * 100 : average);
}

export function componentsForRun(
  components: readonly ScoreComponentRow[],
  runId: string
): ScoreComponentRow[] {
  return components.filter((row) => row.scoringRunId === runId);
}

export function displayedScoreFromCanonicalRun(
  run: ScoringRunRow,
  components: readonly ScoreComponentRow[]
): DisplayedScore | null {
  if (run.engine !== "canonical") return null;
  if (!run.offeringId || !run.deploymentId) return null;
  const own = componentsForRun(components, run.id);
  if (components.length > 0 && own.length === 0) return null;
  return {
    scoringRunId: run.id,
    offeringId: run.offeringId,
    deploymentId: run.deploymentId,
    engine: "canonical",
    methodologyId: run.methodologyId,
    algorithmVersion: run.algorithmVersion,
    rulesetHash: run.rulesetHash,
    dataRevision: run.dataRevision,
    uncertainty: run.uncertainty,
    fallbackLabel: null,
    composite: run.composite,
    rankingLowerBound: run.rankingLowerBound,
    components: own,
    sov_score: aliasScore(own, "sov"),
    oss_score: aliasScore(own, "oss"),
    conf_score: aliasScore(own, "conf"),
  };
}

export function legacySqlDisplayedScore(legacy: LegacySqlScores): DisplayedScore {
  return {
    scoringRunId: null,
    offeringId: null,
    deploymentId: null,
    engine: "legacy-fallback",
    methodologyId: LEGACY_METHODOLOGY_ID,
    algorithmVersion: LEGACY_ALGORITHM_VERSION,
    rulesetHash: LEGACY_RULESET_HASH,
    dataRevision: LEGACY_DATA_REVISION,
    uncertainty: 1,
    fallbackLabel: LEGACY_FALLBACK_LABEL,
    composite: null,
    rankingLowerBound: null,
    components: [],
    sov_score: legacy.sov,
    oss_score: legacy.oss,
    conf_score: legacy.conf,
  };
}

export function bindDisplayedScore(args: {
  legacySql: LegacySqlScores;
  runs: readonly ScoringRunRow[];
  components: readonly ScoreComponentRow[];
  identity?: ScoringRunIdentity | null;
}): DisplayedScore {
  const fallback = legacySqlDisplayedScore(args.legacySql);
  if (!args.identity) return fallback;
  const run = selectLatestMatchingScoringRun(args.runs, args.identity);
  if (!run) return fallback;
  return displayedScoreFromCanonicalRun(run, args.components) ?? fallback;
}
