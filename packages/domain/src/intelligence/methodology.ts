import { INTELLIGENCE_ALGORITHM_VERSION, INTELLIGENCE_METHODOLOGY_ID } from "./types.ts";
import { canonicalJson, sha256Hex } from "../scoring/hash.ts";
import {
  TREND_METRICS,
  type MetricGate,
  type TrendMetric,
} from "./types.ts";

export const METRIC_GATES: Record<TrendMetric, MetricGate> = {
  provider_count_by_country: {
    minObservationCount: 4,
    minContinuity: 0.6,
    minComparablePopulation: 2,
    minRevisionQuality: 1,
    maxMissingness: 0.4,
  },
  offering_count_by_country: {
    minObservationCount: 4,
    minContinuity: 0.6,
    minComparablePopulation: 2,
    minRevisionQuality: 1,
    maxMissingness: 0.4,
  },
  comparable_basket_price_index: {
    minObservationCount: 6,
    minContinuity: 0.75,
    minComparablePopulation: 4,
    minRevisionQuality: 1,
    maxMissingness: 0.25,
  },
  region_facility_expansion: {
    minObservationCount: 4,
    minContinuity: 0.6,
    minComparablePopulation: 2,
    minRevisionQuality: 1,
    maxMissingness: 0.4,
  },
  technology_adoption: {
    minObservationCount: 4,
    minContinuity: 0.6,
    minComparablePopulation: 2,
    minRevisionQuality: 1,
    maxMissingness: 0.4,
  },
  evidence_coverage: {
    minObservationCount: 4,
    minContinuity: 0.6,
    minComparablePopulation: 3,
    minRevisionQuality: 1,
    maxMissingness: 0.35,
  },
  evidence_freshness: {
    minObservationCount: 4,
    minContinuity: 0.6,
    minComparablePopulation: 3,
    minRevisionQuality: 1,
    maxMissingness: 0.35,
  },
  concentration: {
    minObservationCount: 6,
    minContinuity: 0.7,
    minComparablePopulation: 4,
    minRevisionQuality: 1,
    maxMissingness: 0.3,
  },
  verified_additions: {
    minObservationCount: 4,
    minContinuity: 0.5,
    minComparablePopulation: 1,
    minRevisionQuality: 1,
    maxMissingness: 0.5,
  },
  verified_retractions: {
    minObservationCount: 4,
    minContinuity: 0.5,
    minComparablePopulation: 1,
    minRevisionQuality: 1,
    maxMissingness: 0.5,
  },
  verified_conflicts: {
    minObservationCount: 4,
    minContinuity: 0.5,
    minComparablePopulation: 1,
    minRevisionQuality: 1,
    maxMissingness: 0.5,
  },
};

export const INTELLIGENCE_RULESET = {
  id: INTELLIGENCE_METHODOLOGY_ID,
  algorithmVersion: INTELLIGENCE_ALGORITHM_VERSION,
  period: "month",
  staleAfterDays: 180,
  sampling: {
    minEffectiveSampleSize: 4,
    maxStaleShare: 0.4,
    continuity: 'observed-published-verified-in-period',
    effectiveUnit: 'unique-evidence-or-receipt',
  },
  requiredEvidenceClaimTypes: [
    "primary_residency",
    "backup_residency",
    "metadata_residency",
    "legal_entity",
    "facility",
    "technology",
    "price",
  ],
  comparableBasket: {
    requireSameCurrency: true,
    excludePromo: true,
    baselineIndex: 100,
  },
  hhiScale: 10000,
  gates: METRIC_GATES,
  metrics: TREND_METRICS,
  forecast: {
    method: "ruleset_ols",
    minBacktestTrials: 2,
    residualIntervalZ: 1.96,
  },
} as const;

export const INTELLIGENCE_RULESET_HASH = sha256Hex(canonicalJson(INTELLIGENCE_RULESET));

export function gateFor(metric: TrendMetric): MetricGate {
  return METRIC_GATES[metric];
}

export { INTELLIGENCE_ALGORITHM_VERSION, INTELLIGENCE_METHODOLOGY_ID };
