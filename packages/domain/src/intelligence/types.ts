import type { KnowledgeState } from "../knowledge-state.ts";
import type { CountryRecord } from "./countries.ts";

export const TREND_METRICS = [
  "provider_count_by_country",
  "offering_count_by_country",
  "comparable_basket_price_index",
  "region_facility_expansion",
  "technology_adoption",
  "evidence_coverage",
  "evidence_freshness",
  "concentration",
  "verified_additions",
  "verified_retractions",
  "verified_conflicts",
] as const;

export type TrendMetric = (typeof TREND_METRICS)[number];

export const INTELLIGENCE_METHODOLOGY_ID = "asean-trend-series-v1";
export const INTELLIGENCE_ALGORITHM_VERSION = "1.1.0";
export const FORECAST_METHOD = "ruleset_ols";

export const OUTLOOK_LAYERS = [
  "observed_fact",
  "measured_trend",
  "signal",
  "assessment",
  "forecast",
] as const;

export type OutlookLayer = (typeof OUTLOOK_LAYERS)[number];

export const VERIFICATION_STATES = [
  "pending",
  "verified",
  "failed",
  "uncertain",
  "rolled_back",
] as const;

export type VerificationState = (typeof VERIFICATION_STATES)[number];

export const CHANGE_TYPES = ["create", "update", "retract", "rollback", "correction"] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

export const CONCENTRATION_AXES = ["provider", "facility", "operator"] as const;
export type ConcentrationAxis = (typeof CONCENTRATION_AXES)[number];

export const CONFIDENCE_LABELS = ["insufficient", "low", "medium", "high"] as const;
export type ConfidenceLabel = (typeof CONFIDENCE_LABELS)[number];

export const BACKTEST_STATUSES = ["not_run", "pass", "fail", "insufficient"] as const;
export type BacktestStatus = (typeof BACKTEST_STATUSES)[number];

export const FORECAST_PUBLICATION_STATES = [
  "not_published",
  "insufficient_evidence",
  "ineligible",
] as const;
export type ForecastPublicationState = (typeof FORECAST_PUBLICATION_STATES)[number];

export const INTELLIGENCE_SURFACES = ["api", "ui", "mcp"] as const;
export type IntelligenceSurface = (typeof INTELLIGENCE_SURFACES)[number];

export type Period = {
  start: string;
  end: string;
  key: string;
};

export type ObservationWindow = {
  start: string;
  end: string;
};

export type VerifiedFact = {
  receiptId: string;
  revisionId: string;
  changeType: ChangeType;
  entityType: string;
  entityId: string;
  fieldName: string;
  providerId: string | null;
  countryCode: string | null;
  observedAt: string;
  publishedAt: string;
  verificationState: VerificationState;
  knowledgeState: KnowledgeState;
  afterValue: unknown;
  beforeValue: unknown;
  methodologyVersion: string;
  dataRevision: string;
  comparable?: boolean;
  amount?: number | null;
  currency?: string | null;
  billingUnit?: string | null;
  promo?: boolean;
  technologySlug?: string | null;
  facilityId?: string | null;
  operatorId?: string | null;
  evidenceFreshnessDays?: number | null;
  validTo?: string | null;
  supersedesReceiptId?: string | null;
  stale?: boolean;
  /** Immutable identity scope (e.g. country_presence target). Never derived from mutable afterValue. */
  scopeId?: string | null;
  valueSensitivity?: "public" | "redacted";
};

export type TrendPoint = {
  metric: TrendMetric;
  period: Period;
  value: number | null;
  countryCode: string | null;
  providerId: string | null;
  observationCount: number;
  comparablePopulation: number;
  missingness: number;
  continuityContribution: boolean;
  sourceRevisionIds: string[];
  dataRevision: string;
  methodologyVersion: string;
  methodologyHash: string;
  details: Record<string, unknown>;
};

export type SeriesDiagnostics = {
  observationCount: number;
  continuity: number;
  comparablePopulation: number;
  revisionQuality: number;
  missingness: number;
  periodCount: number;
  staleCount: number;
  conflictCount: number;
  pendingCount: number;
  elapsedDays: number;
};

export type MetricGate = {
  minObservationCount: number;
  minContinuity: number;
  minComparablePopulation: number;
  minRevisionQuality: number;
  maxMissingness: number;
};

export type GateFailure = {
  code:
    | "observation_count"
    | "continuity"
    | "comparable_population"
    | "revision_quality"
    | "missingness";
  actual: number;
  threshold: number;
};

export type Eligibility = {
  eligible: boolean;
  metric: TrendMetric;
  failedGates: GateFailure[];
  elapsedDays: number;
  elapsedDaysAloneIsInsufficient: true;
  reason: "eligible" | "insufficient_evidence";
};

export type ObservedFact = {
  layer: "observed_fact";
  asOf: string;
  points: TrendPoint[];
  diagnostics: SeriesDiagnostics;
};

export type MeasuredTrend = {
  layer: "measured_trend";
  direction: "up" | "down" | "flat" | "unknown";
  slope: number | null;
  window: ObservationWindow;
  sampleCount: number;
};

export type TrendSignal = {
  layer: "signal";
  code: string;
  direction: "up" | "down" | "flat" | "unknown";
  strength: number | null;
};

export type OutlookAssessmentLayer = {
  layer: "assessment";
  summary: string;
  caveats: string[];
};

export type ForecastLayer = {
  layer: "forecast";
  pointEstimate: number;
  interval: [number, number];
  horizonEnd: string;
  method: "ruleset_ols";
  modelVersion: string;
  rulesetVersion: string;
  rulesetHash: string;
};

export type Indicator = {
  code: string;
  metric: TrendMetric;
  direction: "up" | "down" | "flat" | "unknown";
  note: string;
};

export type BacktestResult = {
  status: BacktestStatus;
  hitRate: number | null;
  sampleCount: number;
  window: ObservationWindow;
  notes: string;
};

export type OutlookDocument = {
  kind: "outlook";
  metric: TrendMetric;
  countryCode: string | null;
  providerId: string | null;
  observationWindow: ObservationWindow | null;
  baseline: TrendPoint | null;
  observedFact: ObservedFact;
  measuredTrend: MeasuredTrend;
  signal: TrendSignal;
  assessment: OutlookAssessmentLayer;
  forecast: ForecastLayer | null;
  supportingIndicators: Indicator[];
  contradictingIndicators: Indicator[];
  assumptions: string[];
  confidence: {
    label: ConfidenceLabel;
    interval: [number, number] | null;
  };
  provenance: {
    methodologyId: string;
    algorithmVersion: string;
    rulesetHash: string;
    dataRevision: string;
    modelVersion: string;
    rulesetVersion: string;
  };
  expiresAt: string;
  backtest: BacktestResult;
  eligibility: Eligibility;
  publicationState: ForecastPublicationState;
};

export type TimelineEvent = {
  receiptId: string;
  revisionId: string;
  providerId: string | null;
  countryCode: string | null;
  country: CountryRecord | null;
  changeType: ChangeType;
  entityType: string;
  entityId: string;
  fieldName: string;
  observedAt: string;
  publishedAt: string;
  dataRevision: string;
  methodologyVersion: string;
  verificationState: VerificationState;
  knowledgeState: KnowledgeState;
  afterValue: unknown;
  beforeValue: unknown;
  stale: boolean;
  conflict: boolean;
  valueSensitivity: "public" | "redacted";
};

export type TimelineDocument = {
  kind: "provider_timeline" | "country_timeline";
  providerId: string | null;
  countryCode: string | null;
  country: CountryRecord | null;
  events: TimelineEvent[];
  dataRevision: string;
  methodologyVersion: string;
  methodologyHash: string;
};

export type TrendReport = {
  methodologyId: string;
  algorithmVersion: string;
  methodologyHash: string;
  dataRevision: string;
  observationWindow: ObservationWindow | null;
  windowAvailable: boolean;
  insufficientEvidence: boolean;
  countryCode: string | null;
  providerId: string | null;
  series: Record<TrendMetric, TrendPoint[]>;
  diagnostics: Record<TrendMetric, SeriesDiagnostics>;
  eligibility: Record<TrendMetric, Eligibility>;
};

export type IntelligenceQuery = {
  facts: VerifiedFact[];
  window: ObservationWindow | null;
  countryCode?: string | null;
  providerId?: string | null;
  dataRevision?: string | null;
  methodologyVersion?: string | null;
  concentrationAxis?: ConcentrationAxis;
};

export type InferredObservationWindow =
  | { available: true; start: string; end: string }
  | { available: false; reason: "insufficient_evidence" };
