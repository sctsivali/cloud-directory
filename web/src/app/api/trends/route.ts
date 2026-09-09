import { getOutlookEligibility, getTrendReport } from "@/lib/db";
import { DataRevisionError } from '../../../../../packages/domain/src/intelligence/data-revisions.ts';
import { apiJson, apiOptions } from "@/lib/api-json";
import { TREND_METRICS, type TrendMetric, INTELLIGENCE_API_VERSION, guardTrendQuery } from "@/lib/intelligence";

export function OPTIONS() {
  return apiOptions();
}

function optionalInt(raw: string | null): number | undefined {
  if (raw == null || raw === "") return undefined;
  if (!/^-?\d+$/.test(raw)) return Number.NaN;
  return Number(raw);
}

export async function GET(req: Request) {
  try {
    return await getTrends(req);
  } catch (error) {
    if (error instanceof DataRevisionError) return apiJson({ ok: false, code: error.code, error: error.message, apiVersion: INTELLIGENCE_API_VERSION }, 400);
    throw error;
  }
}

async function getTrends(req: Request) {
  const url = new URL(req.url);
  const metric = url.searchParams.get("metric");
  const country = url.searchParams.get("country");
  const providerId = url.searchParams.get("providerId");
  const windowStart = url.searchParams.get("windowStart") ?? undefined;
  const windowEnd = url.searchParams.get("windowEnd") ?? undefined;
  const limit = optionalInt(url.searchParams.get("limit"));
  const page = optionalInt(url.searchParams.get("page"));
  const guarded = guardTrendQuery({ windowStart, windowEnd, limit, page });
  if (!guarded.ok) {
    return apiJson({ ok: false, code: guarded.code, error: guarded.message, apiVersion: INTELLIGENCE_API_VERSION }, 400);
  }
  const report = await getTrendReport({
    dataRevision: url.searchParams.get('dataRevision'),
    countryCode: country,
    providerId,
    ...(guarded.window ? { window: guarded.window } : {}),
  });
  if (metric && (TREND_METRICS as readonly string[]).includes(metric)) {
    const eligibility = await getOutlookEligibility(metric as TrendMetric, country, report.dataRevision);
    return apiJson({
      apiVersion: INTELLIGENCE_API_VERSION,
      metric,
      series: report.series[metric as TrendMetric],
      diagnostics: report.diagnostics[metric as TrendMetric],
      eligibility: report.eligibility[metric as TrendMetric],
      outlookEligibility: eligibility,
      methodologyId: report.methodologyId,
      methodologyHash: report.methodologyHash,
      dataRevision: report.dataRevision,
      observationWindow: report.observationWindow,
      countryCode: report.countryCode,
      providerId: report.providerId,
      forecastPublished: false,
    });
  }
  return apiJson({
    apiVersion: INTELLIGENCE_API_VERSION,
    ...report,
    forecastPublished: false,
  });
}
