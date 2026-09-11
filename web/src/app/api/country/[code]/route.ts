import { getCountryPageData } from "@/lib/db";
import { apiJson, apiOptions } from "@/lib/api-json";
import { INTELLIGENCE_API_VERSION } from "@/lib/intelligence";

export function OPTIONS() {
  return apiOptions();
}

export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  try {
    const data = await getCountryPageData(code);
    return apiJson({
      apiVersion: INTELLIGENCE_API_VERSION,
      country: data.country,
      timeline: data.timeline,
      trends: data.trends,
      forecastPublished: false,
    });
  } catch {
    return apiJson({ error: "unregistered country code" }, 404);
  }
}
