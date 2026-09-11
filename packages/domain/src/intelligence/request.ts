import { canonicalizeCountryCode } from './countries.ts';
import { DataRevisionError, loadDataRevision, type RevisionDatabase } from './data-revisions.ts';
import { buildOutlook, publicOutlookEligibilityView } from './outlook.ts';
import { buildTrendReport, publicTrendView, guardTrendQuery, filterFacts, inferObservationWindow, windowFromInferred } from './trends.ts';
import { TREND_METRICS, type IntelligenceQuery, type TrendMetric } from './types.ts';

export class IntelligenceRequestError extends Error {
  readonly code: string;
  constructor(code: string, message: string = code) { super(message); this.code = code; }
}
export function intelligenceRequestError(error: unknown) {
  if (error instanceof IntelligenceRequestError || error instanceof DataRevisionError) {
    return { ok: false as const, code: error.code, error: error.message };
  }
  throw error;
}

/** Both transports pass raw field values here; neither silently drops invalid filters. */
export function normalizeIntelligenceRequest(raw: unknown, requireMetric = false) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new IntelligenceRequestError('malformed_payload');
  const args = raw as Record<string, unknown>;
  let countryCode: string | null = null;
  if (args.country != null) {
    if (typeof args.country !== 'string' || !(countryCode = canonicalizeCountryCode(args.country))) throw new IntelligenceRequestError('invalid_country');
  }
  let providerId: string | null = null;
  if (args.providerId != null) {
    if (typeof args.providerId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(args.providerId)) throw new IntelligenceRequestError('invalid_provider');
    providerId = args.providerId;
  }
  let metric: TrendMetric | null = null;
  if (args.metric != null || requireMetric) {
    if (typeof args.metric !== 'string' || !(TREND_METRICS as readonly string[]).includes(args.metric)) throw new IntelligenceRequestError('invalid_metric');
    metric = args.metric as TrendMetric;
  }
  const integer = (value: unknown) => value == null ? undefined : typeof value === 'number' ? value : typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : NaN;
  for (const key of ['windowStart', 'windowEnd']) {
    if (args[key] != null && typeof args[key] !== 'string') throw new IntelligenceRequestError('invalid_window');
  }
  const guarded = guardTrendQuery({ windowStart: args.windowStart as string | undefined, windowEnd: args.windowEnd as string | undefined, limit: integer(args.limit), page: integer(args.page) });
  if (!guarded.ok) throw new IntelligenceRequestError(guarded.code, guarded.message);
  if (args.dataRevision != null && (typeof args.dataRevision !== 'string' || !args.dataRevision || args.dataRevision.length > 200)) throw new IntelligenceRequestError('invalid_data_revision');
  return Object.freeze({countryCode, providerId, metric, dataRevision: args.dataRevision as string | null | undefined, window: guarded.window, limit: guarded.limit, page: guarded.page});
}

export async function resolveIntelligenceRequest(db: RevisionDatabase, raw: unknown, loader = loadDataRevision, requireMetric = false) {
  const request = normalizeIntelligenceRequest(raw, requireMetric);
  const snapshot = await loader(db, request.dataRevision);
  // Keep cross-country history inside the provider scope: a later move/retraction
  // must supersede the old country's state before metric-level country filtering.
  const facts = structuredClone(filterFacts({facts: snapshot.facts, window: null, providerId: request.providerId}));
  const freeze = (value: unknown): void => {
    if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  };
  freeze(facts);
  const window = request.window ?? windowFromInferred(inferObservationWindow(filterFacts({facts, window: null, countryCode: request.countryCode})));
  freeze(window);
  const query: IntelligenceQuery = Object.freeze({ facts, window, countryCode: request.countryCode, providerId: request.providerId, dataRevision: snapshot.id });
  return {query, metric: request.metric, limit: request.limit, page: request.page};
}

export function trendResponse(built: Awaited<ReturnType<typeof resolveIntelligenceRequest>>) {
  const view = publicTrendView(buildTrendReport(built.query));
  const metric = built.metric;
  if (!metric) return { ok: true, ...view, forecastPublished: false };
  return {
    ok: true, metric, series: view.series[metric], diagnostics: view.diagnostics[metric], eligibility: view.eligibility[metric],
    outlookEligibility: publicOutlookEligibilityView(buildOutlook(built.query, metric)),
    methodologyId: view.methodologyId, methodologyHash: view.methodologyHash, dataRevision: view.dataRevision,
    observationWindow: view.observationWindow, windowAvailable: view.windowAvailable, insufficientEvidence: view.insufficientEvidence,
    countryCode: view.countryCode, providerId: view.providerId, forecastPublished: false,
  };
}

export async function readTrendRequest(db: RevisionDatabase, raw: unknown) {
  try { return trendResponse(await resolveIntelligenceRequest(db, raw)); }
  catch (error) { return intelligenceRequestError(error); }
}
