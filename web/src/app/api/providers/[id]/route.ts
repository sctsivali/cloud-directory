import { getProvider } from "@/lib/db";
import { apiJson, apiOptions } from "@/lib/api-json";

export function OPTIONS() {
  return apiOptions();
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const p = await getProvider(id);
  if (!p) return apiJson({ error: "not found" }, 404);
  return apiJson({
    id: p.id,
    name: p.name,
    url: `https://guide.cloudin.asia/provider/${p.id}`,
    hq_country: p.hq_country,
    legal_country: p.legal_country,
    origin: p.origin,
    is_local_asean: p.is_local_asean,
    provider_type: p.provider_type,
    data_residency: p.data_residency,
    stack: {
      hypervisor: p.hypervisor,
      orchestration: p.orchestration,
      storage: p.storage,
      control_plane: p.control_plane,
      container_runtime: p.container_runtime,
    },
    sov_score: p.sov_score,
    conf_score: p.conf_score,
    oss_score: p.oss_score,
    cities: p.cities,
    tiers: p.tiers,
    sources: p.sources,
  });
}
