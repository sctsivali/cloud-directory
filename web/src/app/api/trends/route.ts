import { getOutlookEligibility, getTrendReport } from "@/lib/db";
import { apiJson, apiOptions } from "@/lib/api-json";
import { TREND_METRICS, type TrendMetric, INTELLIGENCE_API_VERSION } from "@/lib/intelligence";

export function OPTIONS() {
  return apiOptions();
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const metric = url.searchParams.get("metric");
  const country = url.searchParams.get("country");
  const providerId = url.searchParams.get("providerId");
  const report = await getTrendReport({
    countryCode: country,
    providerId,
  });
  if (metric && (TREND_METRICS as readonly string[]).includes(metric)) {
    const eligibility = await getOutlookEligibility(metric as TrendMetric, country);
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
