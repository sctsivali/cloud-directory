import { getProvider, getProviderTimelineDoc } from "@/lib/db";
import { apiJson, apiOptions } from "@/lib/api-json";
import { INTELLIGENCE_API_VERSION } from "@/lib/intelligence";

export function OPTIONS() {
  return apiOptions();
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const provider = await getProvider(id);
  if (!provider) return apiJson({ error: "not found" }, 404);
  const timeline = await getProviderTimelineDoc(id);
  return apiJson({
    apiVersion: INTELLIGENCE_API_VERSION,
    name: provider.name,
    ...timeline,
    providerId: id,
  });
}
