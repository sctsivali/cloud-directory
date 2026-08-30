import { getMapSites } from "@/lib/db";
import { apiJson, apiOptions } from "@/lib/api-json";

export function OPTIONS() {
  return apiOptions();
}

export async function GET() {
  const sites = await getMapSites();
  return apiJson({ count: sites.length, sites });
}
