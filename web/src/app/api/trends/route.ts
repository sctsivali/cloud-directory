import { getTrendsResponse } from '@/lib/db';
import { apiJson, apiOptions } from '@/lib/api-json';
import { INTELLIGENCE_API_VERSION } from '@/lib/intelligence';

export function OPTIONS() { return apiOptions(); }

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const raw: Record<string, unknown> = {};
  for (const key of ['country', 'providerId', 'metric', 'dataRevision', 'windowStart', 'windowEnd', 'limit', 'page']) {
    if (params.has(key)) raw[key] = params.getAll(key).length === 1 ? params.get(key) : params.getAll(key);
  }
  const result = await getTrendsResponse(raw);
  return apiJson({apiVersion: INTELLIGENCE_API_VERSION, ...result}, result.ok ? 200 : 400);
}
