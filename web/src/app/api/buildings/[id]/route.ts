import { getBuilding } from "@/lib/db";
import { apiJson, apiOptions } from "@/lib/api-json";

export function OPTIONS() {
  return apiOptions();
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isFinite(n)) return apiJson({ error: "not found" }, 404);
  const b = await getBuilding(n);
  if (!b) return apiJson({ error: "not found" }, 404);
  return apiJson({
    id: b.id,
    name: b.listed ? b.name : null,
    listed: b.listed,
    city: b.city,
    country: b.country,
    url: `https://guide.cloudin.asia/building/${b.id}`,
    address: b.address,
    operator: b.operator,
    operator_country: b.operator_country,
    dc_tier: b.dc_tier,
    telcos: b.telcos,
    dc_tech: b.dc_tech,
    facilities: b.facilities,
    lat: b.lat,
    lng: b.lng,
    pin: b.lat != null && b.lng != null,
    photo: b.photo_path ? `https://guide.cloudin.asia${b.photo_path}` : null,
    photo_credit: b.photo_credit,
    last_checked_at: b.last_checked_at,
    providers: b.providers,
  });
}
