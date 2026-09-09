import { evaluateForecastEligibility } from "./gates.ts";
import { INTELLIGENCE_RULESET, INTELLIGENCE_RULESET_HASH } from "./methodology.ts";
import { INTELLIGENCE_ALGORITHM_VERSION, INTELLIGENCE_METHODOLOGY_ID } from "./types.ts";
import { buildTrendSeries, diagnosticsFor, filterFacts } from "./trends.ts";
import type {
  BacktestResult,
  ForecastLayer,
  Indicator,
  IntelligenceQuery,
  MeasuredTrend,
  ObservedFact,
  OutlookAssessmentLayer,
  OutlookDocument,
  TrendMetric,
  TrendPoint,
  TrendSignal,
} from "./types.ts";

const FORECAST_HORIZON_MS = 90 * 86_400_000;
const MS_DAY = 86_400_000;
const MIN_BACKTEST_TRIALS = INTELLIGENCE_RULESET.forecast.minBacktestTrials;
const OLS_Z = INTELLIGENCE_RULESET.forecast.residualIntervalZ;

function numericPoints(points: TrendPoint[]): Array<{ t: number; v: number; point: TrendPoint }> {
  return points
    .filter((p) => p.value != null && Number.isFinite(p.value))
    .map((p) => ({ t: new Date(p.period.start).getTime(), v: p.value as number, point: p }));
}

type OlsFit = {
  intercept: number;
  slopePerDay: number;
  residualStd: number;
  t0: number;
  sampleCount: number;
};

function olsFit(rows: Array<{ t: number; v: number }>): OlsFit | null {
  if (rows.length < 2) return null;
  const t0 = rows[0]!.t;
  const xs = rows.map((r) => (r.t - t0) / MS_DAY);
  const ys = rows.map((r) => r.v);
  const n = rows.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let xx = 0;
  let xy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i]! - meanX;
    xx += dx * dx;
    xy += dx * (ys[i]! - meanY);
  }
  if (xx === 0) return null;
  const slopePerDay = xy / xx;
  const intercept = meanY - slopePerDay * meanX;
  if (n < 3) {
    return { intercept, slopePerDay, residualStd: 0, t0, sampleCount: n };
  }
  let sse = 0;
  for (let i = 0; i < n; i += 1) {
    const pred = intercept + slopePerDay * xs[i]!;
    const err = ys[i]! - pred;
    sse += err * err;
  }
  return { intercept, slopePerDay, residualStd: Math.sqrt(sse / (n - 2)), t0, sampleCount: n };
}

function slopeOf(points: TrendPoint[]): { slope: number | null; direction: MeasuredTrend["direction"]; sampleCount: number } {
  const rows = numericPoints(points);
  const fit = olsFit(rows);
  if (!fit || rows.length < 2) return { slope: null, direction: "unknown", sampleCount: rows.length };
  const spanDays = (rows[rows.length - 1]!.t - rows[0]!.t) / MS_DAY;
  const delta = fit.slopePerDay * spanDays;
  const scale = Math.max(Math.abs(rows[0]!.v), 1);
  const direction: MeasuredTrend["direction"] =
    Math.abs(delta) / scale < 0.02 ? "flat" : delta > 0 ? "up" : "down";
  return { slope: fit.slopePerDay, direction, sampleCount: rows.length };
}

function signalFrom(metric: TrendMetric, trend: MeasuredTrend): TrendSignal {
  if (trend.direction === "unknown") {
    return { layer: "signal", code: "insufficient_series", direction: "unknown", strength: null };
  }
  const code =
    metric === "verified_conflicts"
      ? trend.direction === "up"
        ? "conflict_rising"
        : "conflict_easing"
      : metric === "comparable_basket_price_index"
        ? trend.direction === "up"
          ? "price_pressure"
          : trend.direction === "down"
            ? "price_easing"
            : "price_stable"
        : trend.direction === "up"
          ? "expansion"
          : trend.direction === "down"
            ? "contraction"
            : "stable";
  const strength = trend.slope == null ? null : Math.min(1, Math.abs(trend.slope) / (Math.abs(trend.slope) + 1));
  return { layer: "signal", code, direction: trend.direction, strength };
}

function assess(metric: TrendMetric, signal: TrendSignal, eligibilityReason: string): OutlookAssessmentLayer {
  const caveats = [
    "Outlook is not an observed fact.",
    "Trends are reconstructed from verified published revisions only.",
    "Unknown is not absence.",
  ];
  if (eligibilityReason === "insufficient_evidence") {
    caveats.push("Forecast unpublished: metric-specific evidence gates failed.");
  }
  const summary =
    signal.direction === "unknown"
      ? `No calibrated ${metric} direction can be stated.`
      : `Measured ${metric} direction is ${signal.direction} (${signal.code}).`;
  return { layer: "assessment", summary, caveats };
}

function olsForecast(points: TrendPoint[], horizonEnd: string, allowed: boolean): ForecastLayer | null {
  if (!allowed) return null;
  const rows = numericPoints(points);
  const fit = olsFit(rows);
  if (!fit || rows.length < 3) return null;
  const xHorizon = (new Date(horizonEnd).getTime() - fit.t0) / MS_DAY;
  const pointEstimate = fit.intercept + fit.slopePerDay * xHorizon;
  const half = OLS_Z * fit.residualStd;
  return {
    layer: "forecast",
    pointEstimate,
    interval: [pointEstimate - half, pointEstimate + half],
    horizonEnd,
    method: "ruleset_ols",
    modelVersion: INTELLIGENCE_ALGORITHM_VERSION,
    rulesetVersion: INTELLIGENCE_METHODOLOGY_ID,
    rulesetHash: INTELLIGENCE_RULESET_HASH,
  };
}

export function backtestTrend(points: TrendPoint[]): BacktestResult {
  const rows = numericPoints(points);
  const window = {
    start: points[0]?.period.start ?? new Date(0).toISOString(),
    end: points[points.length - 1]?.period.end ?? new Date(0).toISOString(),
  };
  if (rows.length < 4) {
    return { status: "insufficient", hitRate: null, sampleCount: rows.length, window, notes: "Need at least four numeric points." };
  }
  let hits = 0;
  let trials = 0;
  for (let i = 2; i < rows.length - 1; i += 1) {
    const past = rows.slice(0, i + 1).map((r) => r.point);
    const { direction } = slopeOf(past);
    const next = rows[i + 1]!;
    const last = rows[i]!;
    const actual: MeasuredTrend["direction"] =
      Math.abs(next.v - last.v) / Math.max(Math.abs(last.v), 1) < 0.02 ? "flat" : next.v > last.v ? "up" : "down";
    if (direction === "unknown") continue;
    trials += 1;
    if (direction === actual) hits += 1;
  }
  if (trials < MIN_BACKTEST_TRIALS) {
    return { status: "insufficient", hitRate: null, sampleCount: trials, window, notes: `Walk-forward trials below ${MIN_BACKTEST_TRIALS}.` };
  }
  const hitRate = hits / trials;
  return {
    status: hitRate >= 0.5 ? "pass" : "fail",
    hitRate,
    sampleCount: trials,
    window,
    notes: `Walk-forward directional hits ${hits}/${trials}.`,
  };
}

function indicators(metric: TrendMetric, series: TrendPoint[], trend: MeasuredTrend): { supporting: Indicator[]; contradicting: Indicator[] } {
  const supporting: Indicator[] = [];
  const contradicting: Indicator[] = [];
  const last = series[series.length - 1];
  const first = series[0];
  if (last && first && last.value != null && first.value != null) {
    const item: Indicator = {
      code: "window_delta",
      metric,
      direction: trend.direction,
      note: `Value moved from ${first.value} to ${last.value}.`,
    };
    if (trend.direction === "flat" || trend.direction === "unknown") contradicting.push({ ...item, code: "weak_delta" });
    else supporting.push(item);
  }
  const conflicts = series.some((p) => typeof p.details.conflictCount === "number" && p.details.conflictCount > 0);
  if (conflicts) {
    contradicting.push({
      code: "conflicts_present",
      metric: "verified_conflicts",
      direction: "up",
      note: "Conflicting verified claims exist in the window.",
    });
  }
  return { supporting, contradicting };
}

export function buildOutlook(query: IntelligenceQuery, metric: TrendMetric): OutlookDocument {
  if (!query.window) {
    const diagnostics = {
      observationCount: 0,
      continuity: 0,
      comparablePopulation: 0,
      revisionQuality: 0,
      missingness: 1,
      periodCount: 0,
      staleCount: 0,
      conflictCount: 0,
      pendingCount: 0,
      elapsedDays: 0,
    };
    const eligibility = evaluateForecastEligibility(metric, diagnostics);
    return {
      kind: "outlook",
      metric,
      countryCode: query.countryCode ?? null,
      providerId: query.providerId ?? null,
      observationWindow: null,
      baseline: null,
      observedFact: { layer: "observed_fact", asOf: "", points: [], diagnostics },
      measuredTrend: { layer: "measured_trend", direction: "unknown", slope: null, window: { start: "", end: "" }, sampleCount: 0 },
      signal: { layer: "signal", code: "insufficient_series", direction: "unknown", strength: null },
      assessment: assess(metric, { layer: "signal", code: "insufficient_series", direction: "unknown", strength: null }, "insufficient_evidence"),
      forecast: null,
      supportingIndicators: [],
      contradictingIndicators: [],
      assumptions: [
        "Latest verified revision per entity/field is the period state.",
        "Pending, failed, and unverified receipts are excluded.",
        "Comparable-basket members must appear in the baseline period.",
        "Elapsed days alone never satisfy publication gates.",
        "Forecasts require a passing minimum-trial walk-forward backtest and OLS residual interval.",
      ],
      confidence: { label: "insufficient", interval: null },
      provenance: {
        methodologyId: INTELLIGENCE_METHODOLOGY_ID,
        algorithmVersion: INTELLIGENCE_ALGORITHM_VERSION,
        rulesetHash: INTELLIGENCE_RULESET_HASH,
        dataRevision: query.dataRevision ?? "unspecified",
        modelVersion: INTELLIGENCE_ALGORITHM_VERSION,
        rulesetVersion: INTELLIGENCE_METHODOLOGY_ID,
      },
      expiresAt: "",
      backtest: { status: "insufficient", hitRate: null, sampleCount: 0, window: { start: "", end: "" }, notes: "No observation window." },
      eligibility,
      publicationState: "insufficient_evidence",
    };
  }
  const points = buildTrendSeries(query, metric);
  const scoped = filterFacts(query);
  const diagnostics = diagnosticsFor(metric, points, scoped, query.window);
  const eligibility = evaluateForecastEligibility(metric, diagnostics);
  const measuredTrend: MeasuredTrend = {
    layer: "measured_trend",
    window: query.window,
    ...slopeOf(points),
  };
  const signal = signalFrom(metric, measuredTrend);
  const observedFact: ObservedFact = {
    layer: "observed_fact",
    asOf: query.window.end,
    points,
    diagnostics,
  };
  const assessment = assess(metric, signal, eligibility.reason);
  const expiresAt = new Date(new Date(query.window.end).getTime() + FORECAST_HORIZON_MS).toISOString();
  const { supporting, contradicting } = indicators(metric, points, measuredTrend);
  const backtest = backtestTrend(points);
  const canForecast =
    eligibility.eligible && backtest.status === "pass" && backtest.sampleCount >= MIN_BACKTEST_TRIALS;
  const forecast = olsForecast(points, expiresAt, canForecast);
  const publicationState = forecast ? "not_published" : "insufficient_evidence";
  const confidenceLabel = !forecast
    ? "insufficient"
    : backtest.status === "pass" && (backtest.hitRate ?? 0) >= 0.7
      ? "high"
      : backtest.status === "pass"
        ? "medium"
        : "low";
  return {
    kind: "outlook",
    metric,
    countryCode: query.countryCode ?? null,
    providerId: query.providerId ?? null,
    observationWindow: query.window,
    baseline: points[0] ?? null,
    observedFact,
    measuredTrend,
    signal,
    assessment,
    forecast,
    supportingIndicators: supporting,
    contradictingIndicators: contradicting,
    assumptions: [
      "Latest verified revision per entity/field is the period state.",
      "Pending, failed, and unverified receipts are excluded.",
      "Comparable-basket members must appear in the baseline period.",
      "Elapsed days alone never satisfy publication gates.",
      "OLS is fit to all numeric period points; the interval is ±1.96 residual standard errors (n-2).",
      "A passing walk-forward backtest with at least two trials is required before a forecast exists.",
    ],
    confidence: {
      label: confidenceLabel,
      interval: forecast?.interval ?? null,
    },
    provenance: {
      methodologyId: INTELLIGENCE_METHODOLOGY_ID,
      algorithmVersion: INTELLIGENCE_ALGORITHM_VERSION,
      rulesetHash: INTELLIGENCE_RULESET_HASH,
      dataRevision: query.dataRevision ?? "unspecified",
      modelVersion: INTELLIGENCE_ALGORITHM_VERSION,
      rulesetVersion: INTELLIGENCE_METHODOLOGY_ID,
    },
    expiresAt,
    backtest,
    eligibility,
    publicationState,
  };
}

export function outlookLayersAreSeparated(doc: OutlookDocument): boolean {
  if (doc.observedFact.layer !== "observed_fact") return false;
  if (doc.measuredTrend.layer !== "measured_trend") return false;
  if (doc.signal.layer !== "signal") return false;
  if (doc.assessment.layer !== "assessment") return false;
  if (doc.forecast && doc.forecast.layer !== "forecast") return false;
  const observedText = JSON.stringify(doc.observedFact);
  if (observedText.includes('"layer":"forecast"')) return false;
  if (observedText.includes("pointEstimate")) return false;
  return true;
}

export function refuseForecastPublication(input: {
  outlook: OutlookDocument;
  source: "ruleset" | "ai";
}): { ok: false; code: "insufficient_evidence" | "ai_forecast_forbidden"; message: string } | { ok: true } {
  if (input.source === "ai") {
    return {
      ok: false,
      code: "ai_forecast_forbidden",
      message: "AI-generated forecast publication is not available.",
    };
  }
  if (!input.outlook.eligibility.eligible || !input.outlook.forecast || input.outlook.backtest.status !== "pass") {
    return {
      ok: false,
      code: "insufficient_evidence",
      message: "Forecast unpublished: insufficient evidence for this metric.",
    };
  }
  return { ok: true };
}

export function publicOutlookEligibilityView(doc: OutlookDocument) {
  return {
    metric: doc.metric,
    countryCode: doc.countryCode,
    providerId: doc.providerId,
    observationWindow: doc.observationWindow,
    eligibility: doc.eligibility,
    publicationState: doc.publicationState,
    confidence: { label: doc.confidence.label },
    backtest: { status: doc.backtest.status, sampleCount: doc.backtest.sampleCount },
    provenance: doc.provenance,
    expiresAt: doc.expiresAt,
    forecastPublished: false,
    insufficientEvidence: doc.publicationState === "insufficient_evidence",
  };
}
