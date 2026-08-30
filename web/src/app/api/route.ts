import { apiJson, apiOptions } from "@/lib/api-json";

export function OPTIONS() {
  return apiOptions();
}

export function GET() {
  const base = "https://guide.cloudin.asia";
  return apiJson({
    name: "Cloud Directory API",
    site: base,
    license: "data as published on guide.cloudin.asia",
    endpoints: {
      providers: `${base}/api/providers`,
      provider: `${base}/api/providers/{id}`,
      buildings: `${base}/api/buildings`,
      building: `${base}/api/buildings/{id}`,
      map: `${base}/api/map`,
      updates: `${base}/api/updates`,
    },
  });
}
