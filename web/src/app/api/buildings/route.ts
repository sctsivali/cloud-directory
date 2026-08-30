import { getBuildings } from "@/lib/db";
import { apiJson, apiOptions } from "@/lib/api-json";

export function OPTIONS() {
  return apiOptions();
}

export async function GET() {
  const rows = await getBuildings();
  return apiJson({
    count: rows.length,
    buildings: rows.map((b) => ({
      id: b.id,
      name: b.name,
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
      photo: b.photo_path
        ? `https://guide.cloudin.asia${b.photo_path}`
        : null,
      last_checked_at: b.last_checked_at,
      provider_count: b.provider_count,
    })),
  });
}
