import { gateFor } from "./methodology.ts";
import type { Eligibility, GateFailure, SeriesDiagnostics, TrendMetric } from "./types.ts";

function fail(
  code: GateFailure["code"],
  actual: number,
  threshold: number
): GateFailure {
  return { code, actual, threshold };
}

/**
 * Metric-specific forecast eligibility. Elapsed calendar days are recorded
 * but never sufficient on their own — even 90+ days cannot authorize a forecast.
 */
export function evaluateForecastEligibility(
  metric: TrendMetric,
  diagnostics: SeriesDiagnostics
): Eligibility {
  const gate = gateFor(metric);
  const failed: GateFailure[] = [];
  if (diagnostics.observationCount < gate.minObservationCount) {
    failed.push(fail("observation_count", diagnostics.observationCount, gate.minObservationCount));
  }
  if (diagnostics.continuity < gate.minContinuity) {
    failed.push(fail("continuity", diagnostics.continuity, gate.minContinuity));
  }
  if (diagnostics.comparablePopulation < gate.minComparablePopulation) {
    failed.push(fail("comparable_population", diagnostics.comparablePopulation, gate.minComparablePopulation));
  }
  if (diagnostics.revisionQuality < gate.minRevisionQuality) {
    failed.push(fail("revision_quality", diagnostics.revisionQuality, gate.minRevisionQuality));
  }
  if (diagnostics.missingness > gate.maxMissingness) {
    failed.push(fail("missingness", diagnostics.missingness, gate.maxMissingness));
  }
  return {
    eligible: failed.length === 0,
    metric,
    failedGates: failed,
    elapsedDays: diagnostics.elapsedDays,
    elapsedDaysAloneIsInsufficient: true,
    reason: failed.length === 0 ? "eligible" : "insufficient_evidence",
  };
}

export function elapsedDaysCannotAuthorizeForecast(elapsedDays: number, eligibility: Eligibility): boolean {
  return elapsedDays >= 0 && eligibility.elapsedDaysAloneIsInsufficient && !eligibility.eligible;
}
