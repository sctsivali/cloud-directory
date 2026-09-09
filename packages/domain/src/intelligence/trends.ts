import { canonicalizeCountryCode, extractCountryFromValue } from "./countries.ts";
import { INTELLIGENCE_RULESET, INTELLIGENCE_RULESET_HASH } from "./methodology.ts";
import { evaluateForecastEligibility } from "./gates.ts";
import {
  INTELLIGENCE_ALGORITHM_VERSION,
  INTELLIGENCE_METHODOLOGY_ID,
  INTELLIGENCE_SURFACES,
  TREND_METRICS,
  type InferredObservationWindow,
  type IntelligenceQuery,
  type IntelligenceSurface,
  type ObservationWindow,
  type Period,
  type SeriesDiagnostics,
  type TrendMetric,
  type TrendPoint,
  type TrendReport,
  type VerifiedFact,
} from "./types.ts";

export { INTELLIGENCE_SURFACES, type IntelligenceSurface };

const MS_DAY = 86_400_000;
export const MAX_TREND_WINDOW_MONTHS = 120;
export const MAX_TREND_FACTS = 10_000;
export const MAX_TREND_PAGE_SIZE = 100;
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export type TrendWindowValidation =
  | { ok: true; start: string; end: string; months: number }
  | { ok: false; code: "invalid_window" | "window_too_large"; message: string };

export type TrendQueryGuard =
  | { ok: true; window: ObservationWindow | null; limit: number; page: number }
  | { ok: false; code: string; message: string };

export function canonicalTimestamp(value: string): string | null {
  if (!CANONICAL_TIMESTAMP.test(value)) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.toISOString() !== value) return null;
  return value;
}

export function countEnumeratedMonths(windowStart: string, windowEnd: string): number {
  const start = new Date(windowStart);
  const end = new Date(windowEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return Number.POSITIVE_INFINITY;
  let year = start.getUTCFullYear();
  let month = start.getUTCMonth();
  let n = 0;
  while (Date.UTC(year, month, 1) < end.getTime()) {
    n += 1;
    if (n > MAX_TREND_WINDOW_MONTHS + 1) return n;
    month += 1;
    if (month === 12) {
      month = 0;
      year += 1;
    }
  }
  return n;
}

export function validateObservationWindow(start: string, end: string): TrendWindowValidation {
  const canonicalStart = canonicalTimestamp(start);
  const canonicalEnd = canonicalTimestamp(end);
  if (!canonicalStart || !canonicalEnd) {
    return {
      ok: false,
      code: "invalid_window",
      message: "window timestamps must be canonical UTC ISO-8601",
    };
  }
  if (!(canonicalStart < canonicalEnd)) {
    return { ok: false, code: "invalid_window", message: "window start must be before end" };
  }
  const months = countEnumeratedMonths(canonicalStart, canonicalEnd);
  if (months < 1) {
    return { ok: false, code: "invalid_window", message: "window start must be before end" };
  }
  if (months > MAX_TREND_WINDOW_MONTHS) {
    return {
      ok: false,
      code: "window_too_large",
      message: `observation window cannot exceed ${MAX_TREND_WINDOW_MONTHS} months`,
    };
  }
  return { ok: true, start: canonicalStart, end: canonicalEnd, months };
}

export function guardTrendQuery(args: {
  windowStart?: string;
  windowEnd?: string;
  limit?: number;
  page?: number;
}): TrendQueryGuard {
  const limit = args.limit ?? 50;
  const page = args.page ?? 1;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_TREND_PAGE_SIZE) {
    return { ok: false, code: "invalid_limit", message: `limit must be an integer from 1 to ${MAX_TREND_PAGE_SIZE}` };
  }
  if (!Number.isInteger(page) || page < 1 || page > 1000) {
    return { ok: false, code: "invalid_page", message: "page must be an integer from 1 to 1000" };
  }
  if (args.windowStart != null || args.windowEnd != null) {
    if (args.windowStart == null || args.windowEnd == null) {
      return { ok: false, code: "invalid_window", message: "windowStart and windowEnd are both required" };
    }
    const window = validateObservationWindow(args.windowStart, args.windowEnd);
    if (!window.ok) return window;
    return { ok: true, window: { start: window.start, end: window.end }, limit, page };
  }
  return { ok: true, window: null, limit, page };
}

export function immutableScopeId(fact: VerifiedFact): string | null {
  if (fact.scopeId) return fact.scopeId;
  if (fact.fieldName === "country_presence") {
    return canonicalizeCountryCode(fact.countryCode);
  }
  return null;
}

export function entityKey(fact: VerifiedFact): string {
  const scope = immutableScopeId(fact);
  return scope
    ? `${fact.entityType}:${fact.entityId}:${fact.fieldName}:${scope}`
    : `${fact.entityType}:${fact.entityId}:${fact.fieldName}`;
}

export function monthPeriod(iso: string): Period {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`invalid timestamp: ${iso}`);
  }
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  const key = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
  return { start: start.toISOString(), end: end.toISOString(), key };
}

export function enumerateMonths(windowStart: string, windowEnd: string): Period[] {
  const checked = validateObservationWindow(windowStart, windowEnd);
  if (!checked.ok) {
    throw new Error(checked.message);
  }
  const start = monthPeriod(checked.start);
  const endExclusive = new Date(checked.end);
  const periods: Period[] = [];
  let cursor = new Date(start.start);
  while (cursor.getTime() < endExclusive.getTime()) {
    periods.push(monthPeriod(cursor.toISOString()));
    if (periods.length > MAX_TREND_WINDOW_MONTHS) {
      throw new Error(`observation window cannot exceed ${MAX_TREND_WINDOW_MONTHS} months`);
    }
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return periods;
}

export function resolveFactCountry(fact: VerifiedFact): string | null {
  return canonicalizeCountryCode(fact.countryCode) ?? extractCountryFromValue(fact.afterValue);
}

export function isVerified(fact: VerifiedFact): boolean {
  return fact.verificationState === "verified";
}

export function isAbsentState(fact: VerifiedFact): boolean {
  return fact.changeType === "retract" || fact.knowledgeState === "confirmed_absent";
}

export function isAbsentChange(fact: VerifiedFact): boolean {
  return isAbsentState(fact);
}

export function isStaleAt(fact: VerifiedFact, asOf: string): boolean {
  if (fact.stale) return true;
  const asOfMs = new Date(asOf).getTime();
  if (Number.isNaN(asOfMs)) return true;
  if (fact.validTo) return new Date(fact.validTo).getTime() <= asOfMs;
  const observed = new Date(fact.observedAt).getTime();
  if (Number.isNaN(observed)) return true;
  const ageDays = (asOfMs - observed) / MS_DAY;
  if (fact.evidenceFreshnessDays != null) return ageDays > fact.evidenceFreshnessDays;
  return ageDays > INTELLIGENCE_RULESET.staleAfterDays;
}

function compareFacts(a: VerifiedFact, b: VerifiedFact): number {
  const observed = a.observedAt.localeCompare(b.observedAt);
  if (observed !== 0) return observed;
  const published = a.publishedAt.localeCompare(b.publishedAt);
  if (published !== 0) return published;
  return a.receiptId.localeCompare(b.receiptId);
}

export function latestStateByEntity(
  facts: VerifiedFact[],
  asOf: string
): Map<string, VerifiedFact> {
  const latest = new Map<string, VerifiedFact>();
  const eligible = facts
    .filter((fact) => isVerified(fact) && fact.observedAt < asOf)
    .slice()
    .sort(compareFacts);
  for (const fact of eligible) {
    latest.set(entityKey(fact), fact);
  }
  return latest;
}

function presentFacts(state: Map<string, VerifiedFact>, asOf: string, opts?: { excludeStale?: boolean }): VerifiedFact[] {
  const rows: VerifiedFact[] = [];
  for (const fact of state.values()) {
    if (isAbsentChange(fact)) continue;
    if (fact.knowledgeState === "conflicting" || fact.knowledgeState === "confirmed_absent") continue;
    if (fact.knowledgeState === "unknown" || fact.knowledgeState === "not_applicable") continue;
    if (opts?.excludeStale && isStaleAt(fact, asOf)) continue;
    if (fact.knowledgeState !== "present") continue;
    rows.push(fact);
  }
  return rows;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function matchesProvider(fact: VerifiedFact, providerId?: string | null): boolean {
  if (providerId && fact.providerId !== providerId) return false;
  return true;
}

function countryMatches(fact: VerifiedFact, countryCode?: string | null): boolean {
  if (!countryCode) return true;
  return resolveFactCountry(fact) === countryCode;
}

function matchesScope(fact: VerifiedFact, countryCode?: string | null, providerId?: string | null): boolean {
  return matchesProvider(fact, providerId) && countryMatches(fact, countryCode);
}

function amountOf(fact: VerifiedFact): number | null {
  if (typeof fact.amount === "number" && Number.isFinite(fact.amount)) return fact.amount;
  if (fact.afterValue && typeof fact.afterValue === "object" && "amount" in fact.afterValue) {
    const amount = (fact.afterValue as { amount?: unknown }).amount;
    if (typeof amount === "number" && Number.isFinite(amount)) return amount;
  }
  return null;
}

function currencyOf(fact: VerifiedFact): string | null {
  if (fact.currency) return fact.currency;
  if (fact.afterValue && typeof fact.afterValue === "object" && "currency" in fact.afterValue) {
    const currency = (fact.afterValue as { currency?: unknown }).currency;
    return typeof currency === "string" ? currency : null;
  }
  return null;
}

function isComparablePrice(fact: VerifiedFact): boolean {
  if (fact.promo) return false;
  if (fact.comparable === false) return false;
  const amount = amountOf(fact);
  return amount != null && amount > 0 && Boolean(currencyOf(fact));
}

function hhi(counts: Map<string, number>): number | null {
  let total = 0;
  for (const n of counts.values()) total += n;
  if (total <= 0) return null;
  let sum = 0;
  for (const n of counts.values()) {
    const share = n / total;
    sum += share * share;
  }
  return sum * INTELLIGENCE_RULESET.hhiScale;
}

function axisId(fact: VerifiedFact, axis: IntelligenceQuery["concentrationAxis"]): string | null {
  if (axis === "facility") return fact.facilityId ?? (fact.fieldName === "facility" ? fact.entityId : null);
  if (axis === "operator") return fact.operatorId ?? null;
  return fact.providerId;
}

export function inferObservationWindow(
  facts: VerifiedFact[],
  override?: { start?: string; end?: string }
): InferredObservationWindow {
  if (override?.start || override?.end) {
    if (!override.start || !override.end) {
      return { available: false, reason: "insufficient_evidence" };
    }
    const checked = validateObservationWindow(override.start, override.end);
    if (!checked.ok) return { available: false, reason: "insufficient_evidence" };
    return { available: true, start: checked.start, end: checked.end };
  }
  const verified = facts.filter(isVerified);
  if (verified.length === 0) {
    return { available: false, reason: "insufficient_evidence" };
  }
  let min = verified[0]!.observedAt;
  let max = verified[0]!.observedAt;
  for (const fact of verified) {
    if (fact.observedAt < min) min = fact.observedAt;
    if (fact.observedAt > max) max = fact.observedAt;
  }
  let inferred: { start: string; end: string };
  try {
    inferred = { start: monthPeriod(min).start, end: monthPeriod(max).end };
  } catch {
    return { available: false, reason: "insufficient_evidence" };
  }
  const checked = validateObservationWindow(inferred.start, inferred.end);
  if (!checked.ok) return { available: false, reason: "insufficient_evidence" };
  return { available: true, start: checked.start, end: checked.end };
}

export function windowFromInferred(inferred: InferredObservationWindow): ObservationWindow | null {
  return inferred.available ? { start: inferred.start, end: inferred.end } : null;
}

export function filterFacts(query: IntelligenceQuery): VerifiedFact[] {
  return query.facts.filter((fact) => matchesScope(fact, query.countryCode, query.providerId));
}

function flowEvents(facts: VerifiedFact[], period: Period, changeTypes: VerifiedFact["changeType"][]): VerifiedFact[] {
  const wanted = new Set(changeTypes);
  const seen = new Set<string>();
  const rows: VerifiedFact[] = [];
  const inPeriod = facts
    .filter((fact) => isVerified(fact) && fact.observedAt >= period.start && fact.observedAt < period.end && wanted.has(fact.changeType))
    .sort(compareFacts);
  for (const fact of inPeriod) {
    const key = `${entityKey(fact)}:${fact.changeType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(fact);
  }
  return rows;
}

function point(
  metric: TrendMetric,
  period: Period,
  value: number | null,
  query: IntelligenceQuery,
  observationCount: number,
  comparablePopulation: number,
  missingness: number,
  sourceRevisionIds: string[],
  details: Record<string, unknown>
): TrendPoint {
  return {
    metric,
    period,
    value,
    countryCode: query.countryCode ?? null,
    providerId: query.providerId ?? null,
    observationCount,
    comparablePopulation,
    missingness,
    continuityContribution: observationCount > 0,
    sourceRevisionIds: unique(sourceRevisionIds).sort(),
    dataRevision: query.dataRevision ?? "unspecified",
    methodologyVersion: query.methodologyVersion ?? INTELLIGENCE_METHODOLOGY_ID,
    methodologyHash: INTELLIGENCE_RULESET_HASH,
    details,
  };
}

function metricValue(
  metric: TrendMetric,
  period: Period,
  providerScoped: VerifiedFact[],
  countryScoped: VerifiedFact[],
  query: IntelligenceQuery,
  baselinePrices: Map<string, { amount: number; currency: string }>
): TrendPoint {
  const asOf = period.end;
  const state = latestStateByEntity(providerScoped, asOf);
  const present = presentFacts(state, asOf).filter((row) => countryMatches(row, query.countryCode));
  const evidencePresent = presentFacts(state, asOf, { excludeStale: true }).filter((row) =>
    countryMatches(row, query.countryCode)
  );
  const evidenceAll = presentFacts(state, asOf).filter((row) => countryMatches(row, query.countryCode));
  const revisions = unique(present.map((row) => row.revisionId));

  if (metric === "provider_count_by_country") {
    const ids = unique(present.filter((row) => row.fieldName === "country_presence" || row.entityType === "provider").map((row) => row.providerId ?? row.entityId));
    return point(metric, period, ids.length, query, ids.length, ids.length, 0, revisions, { providerIds: ids.slice().sort() });
  }
  if (metric === "offering_count_by_country") {
    const ids = unique(present.filter((row) => row.fieldName === "offering" || row.entityType === "offering").map((row) => row.entityId));
    return point(metric, period, ids.length, query, ids.length, ids.length, 0, revisions, { offeringIds: ids.slice().sort() });
  }
  if (metric === "region_facility_expansion") {
    const facilities = unique(present.filter((row) => row.fieldName === "facility" || row.entityType === "facility").map((row) => row.facilityId ?? row.entityId));
    const regions = unique(present.filter((row) => row.fieldName === "region" || row.entityType === "region").map((row) => row.entityId));
    const n = facilities.length + regions.length;
    return point(metric, period, n, query, n, n, 0, revisions, { facilityIds: facilities.slice().sort(), regionIds: regions.slice().sort() });
  }
  if (metric === "technology_adoption") {
    const slugs = unique(
      present
        .filter((row) => row.fieldName === "technology" || row.entityType === "technology")
        .map((row) => row.technologySlug ?? row.entityId)
    );
    return point(metric, period, slugs.length, query, slugs.length, slugs.length, 0, revisions, { technologySlugs: slugs.slice().sort() });
  }
  if (metric === "verified_additions") {
    const rows = flowEvents(countryScoped, period, ["create"]);
    return point(metric, period, rows.length, query, rows.length, rows.length, 0, rows.map((r) => r.revisionId), {});
  }
  if (metric === "verified_retractions") {
    const retracts = flowEvents(countryScoped, period, ["retract"]);
    const rollbackAbsences = flowEvents(countryScoped, period, ["rollback"]).filter(isAbsentState);
    const rows = [...retracts, ...rollbackAbsences];
    return point(metric, period, rows.length, query, rows.length, rows.length, 0, rows.map((r) => r.revisionId), {});
  }
  if (metric === "verified_conflicts") {
    const conflicts = [...state.values()].filter(
      (row) => !isAbsentChange(row) && row.knowledgeState === "conflicting" && countryMatches(row, query.countryCode)
    );
    const keys = unique(conflicts.map(entityKey));
    return point(metric, period, keys.length, query, keys.length, keys.length, 0, conflicts.map((r) => r.revisionId), { keys: keys.slice().sort() });
  }
  if (metric === "evidence_coverage") {
    const required = INTELLIGENCE_RULESET.requiredEvidenceClaimTypes as readonly string[];
    const evidence = evidencePresent.filter((row) => row.fieldName === "evidence" || row.entityType === "evidence" || required.includes(row.fieldName));
    const types = unique(evidence.map((row) => row.fieldName).filter((name) => required.includes(name)));
    const denom = required.length;
    const coverage = denom === 0 ? null : types.length / denom;
    const missingness = denom === 0 ? 0 : 1 - types.length / denom;
    return point(metric, period, coverage, query, evidence.length, denom, missingness, evidence.map((r) => r.revisionId), {
      presentClaimTypes: types.slice().sort(),
      requiredClaimTypes: [...required],
    });
  }
  if (metric === "evidence_freshness") {
    const required = INTELLIGENCE_RULESET.requiredEvidenceClaimTypes as readonly string[];
    const evidence = evidenceAll.filter(
      (row) => row.fieldName === "evidence" || row.entityType === "evidence" || required.includes(row.fieldName)
    );
    const ages = evidence.map((row) => (new Date(asOf).getTime() - new Date(row.observedAt).getTime()) / MS_DAY);
    const fresh = evidence.filter((row) => !isStaleAt(row, asOf));
    const missingness = evidence.length === 0 ? 1 : 1 - fresh.length / evidence.length;
    return point(metric, period, median(ages), query, evidence.length, evidence.length, missingness, evidence.map((r) => r.revisionId), {
      freshCount: fresh.length,
      staleCount: evidence.length - fresh.length,
    });
  }
  if (metric === "concentration") {
    const axis = query.concentrationAxis ?? "provider";
    const offerings = present.filter((row) => row.fieldName === "offering" || row.entityType === "offering");
    const counts = new Map<string, number>();
    for (const row of offerings) {
      const id = axisId(row, axis);
      if (!id) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const value = hhi(counts);
    const pop = [...counts.values()].reduce((a, b) => a + b, 0);
    return point(metric, period, value, query, pop, pop, pop === 0 ? 1 : 0, offerings.map((r) => r.revisionId), {
      axis,
      shares: Object.fromEntries(counts),
    });
  }
  if (metric === "comparable_basket_price_index") {
    const prices = present.filter((row) => (row.fieldName === "price" || row.entityType === "price") && isComparablePrice(row));
    const current = new Map<string, { amount: number; currency: string; revisionId: string }>();
    for (const row of prices) {
      const amount = amountOf(row);
      const currency = currencyOf(row);
      if (amount == null || !currency) continue;
      current.set(row.entityId, { amount, currency, revisionId: row.revisionId });
    }
    const ratios: number[] = [];
    const members: string[] = [];
    for (const [id, base] of baselinePrices) {
      const now = current.get(id);
      if (!now) continue;
      if (INTELLIGENCE_RULESET.comparableBasket.requireSameCurrency && now.currency !== base.currency) continue;
      ratios.push(now.amount / base.amount);
      members.push(id);
    }
    const missingness = baselinePrices.size === 0 ? 1 : 1 - members.length / baselinePrices.size;
    const index = ratios.length === 0 ? null : INTELLIGENCE_RULESET.comparableBasket.baselineIndex * (ratios.reduce((a, b) => a + b, 0) / ratios.length);
    return point(metric, period, index, query, ratios.length, members.length, missingness, prices.map((r) => r.revisionId), {
      basketIds: members.slice().sort(),
    });
  }
  return point(metric, period, null, query, 0, 0, 1, [], {});
}

function baselinePriceBasket(
  providerScoped: VerifiedFact[],
  periods: Period[],
  countryCode?: string | null
): Map<string, { amount: number; currency: string }> {
  if (periods.length === 0) return new Map();
  const first = periods[0]!;
  const state = latestStateByEntity(providerScoped, first.end);
  const present = presentFacts(state, first.end).filter((row) => countryMatches(row, countryCode));
  const basket = new Map<string, { amount: number; currency: string }>();
  for (const row of present) {
    if (row.fieldName !== "price" && row.entityType !== "price") continue;
    if (!isComparablePrice(row)) continue;
    const amount = amountOf(row);
    const currency = currencyOf(row);
    if (amount == null || !currency) continue;
    basket.set(row.entityId, { amount, currency });
  }
  return basket;
}

export function diagnosticsFor(
  metric: TrendMetric,
  points: TrendPoint[],
  allFacts: VerifiedFact[],
  window: { start: string; end: string }
): SeriesDiagnostics {
  const observationCount = points.reduce((n, p) => n + p.observationCount, 0);
  const periodCount = points.length;
  const continuity = periodCount === 0 ? 0 : points.filter((p) => p.continuityContribution).length / periodCount;
  const comparablePopulation = points.reduce((n, p) => Math.max(n, p.comparablePopulation), 0);
  const missingness = periodCount === 0 ? 1 : points.reduce((n, p) => n + p.missingness, 0) / periodCount;
  const verified = allFacts.filter(isVerified).length;
  const pending = allFacts.filter((f) => f.verificationState === "pending" || f.verificationState === "failed" || f.verificationState === "uncertain").length;
  const revisionQuality = verified + pending === 0 ? 0 : verified / (verified + pending);
  const staleCount = allFacts.filter((f) => isVerified(f) && isStaleAt(f, window.end)).length;
  const conflictCount = allFacts.filter((f) => isVerified(f) && f.knowledgeState === "conflicting").length;
  const elapsedDays = Math.max(0, (new Date(window.end).getTime() - new Date(window.start).getTime()) / MS_DAY);
  return {
    observationCount,
    continuity,
    comparablePopulation,
    revisionQuality,
    missingness,
    periodCount,
    staleCount,
    conflictCount,
    pendingCount: pending,
    elapsedDays,
  };
}

function emptyDiagnostics(): SeriesDiagnostics {
  return {
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
}

function emptyTrendReport(query: IntelligenceQuery): TrendReport {
  const series = {} as Record<TrendMetric, TrendPoint[]>;
  const diagnostics = {} as Record<TrendMetric, SeriesDiagnostics>;
  const eligibility = {} as TrendReport["eligibility"];
  for (const metric of TREND_METRICS) {
    series[metric] = [];
    diagnostics[metric] = emptyDiagnostics();
    eligibility[metric] = evaluateForecastEligibility(metric, diagnostics[metric]);
  }
  return {
    methodologyId: INTELLIGENCE_METHODOLOGY_ID,
    algorithmVersion: INTELLIGENCE_ALGORITHM_VERSION,
    methodologyHash: INTELLIGENCE_RULESET_HASH,
    dataRevision: query.dataRevision ?? "unspecified",
    observationWindow: null,
    windowAvailable: false,
    insufficientEvidence: true,
    countryCode: query.countryCode ?? null,
    providerId: query.providerId ?? null,
    series,
    diagnostics,
    eligibility,
  };
}

export function buildTrendSeries(query: IntelligenceQuery, metric: TrendMetric): TrendPoint[] {
  if (!query.window) return [];
  const checked = validateObservationWindow(query.window.start, query.window.end);
  if (!checked.ok) return [];
  if (query.facts.length > MAX_TREND_FACTS) return [];
  const providerScoped = query.facts.filter((fact) => matchesProvider(fact, query.providerId));
  const countryScoped = filterFacts(query);
  const periods = enumerateMonths(checked.start, checked.end);
  const baselinePrices = baselinePriceBasket(providerScoped, periods, query.countryCode);
  return periods.map((period) => metricValue(metric, period, providerScoped, countryScoped, query, baselinePrices));
}

export function buildTrendReport(query: IntelligenceQuery): TrendReport {
  if (!query.window) return emptyTrendReport(query);
  const checked = validateObservationWindow(query.window.start, query.window.end);
  if (!checked.ok || query.facts.length > MAX_TREND_FACTS) return emptyTrendReport(query);
  const scoped = filterFacts(query);
  const series = {} as Record<TrendMetric, TrendPoint[]>;
  const diagnostics = {} as Record<TrendMetric, SeriesDiagnostics>;
  const eligibility = {} as TrendReport["eligibility"];
  for (const metric of TREND_METRICS) {
    const points = buildTrendSeries(query, metric);
    series[metric] = points;
    diagnostics[metric] = diagnosticsFor(metric, points, scoped, query.window);
    eligibility[metric] = evaluateForecastEligibility(metric, diagnostics[metric]);
  }
  return {
    methodologyId: INTELLIGENCE_METHODOLOGY_ID,
    algorithmVersion: INTELLIGENCE_ALGORITHM_VERSION,
    methodologyHash: INTELLIGENCE_RULESET_HASH,
    dataRevision: query.dataRevision ?? "unspecified",
    observationWindow: query.window,
    windowAvailable: true,
    insufficientEvidence: false,
    countryCode: query.countryCode ?? null,
    providerId: query.providerId ?? null,
    series,
    diagnostics,
    eligibility,
  };
}

export function trendsForSurface(_surface: IntelligenceSurface, query: IntelligenceQuery): TrendReport {
  return buildTrendReport(query);
}

export function publicTrendView(report: TrendReport) {
  return {
    methodologyId: report.methodologyId,
    algorithmVersion: report.algorithmVersion,
    methodologyHash: report.methodologyHash,
    dataRevision: report.dataRevision,
    observationWindow: report.observationWindow,
    windowAvailable: report.windowAvailable,
    insufficientEvidence: report.insufficientEvidence,
    countryCode: report.countryCode,
    providerId: report.providerId,
    series: report.series,
    diagnostics: report.diagnostics,
    eligibility: report.eligibility,
  };
}
