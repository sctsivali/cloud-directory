import { getArena } from "@/lib/db";
import { apiJson, apiOptions } from "@/lib/api-json";

export function OPTIONS() {
  return apiOptions();
}

export async function GET() {
  const rows = await getArena();
  return apiJson({
    count: rows.length,
    providers: rows.map((p) => ({
      id: p.id,
      name: p.name,
      website_path: `/provider/${p.id}`,
      hq_country: p.hq_country,
      legal_country: p.legal_country,
      origin: p.origin,
      is_local_asean: p.is_local_asean,
      data_residency: p.data_residency,
      hypervisor: p.hypervisor,
      orchestration: p.orchestration,
      storage: p.storage,
      control_plane: p.control_plane,
      tier_count: p.tier_count,
      min_price_usd_month: p.min_price,
      sov_score: p.sov_score,
      conf_score: p.conf_score,
      oss_score: p.oss_score,
    })),
  });
}
