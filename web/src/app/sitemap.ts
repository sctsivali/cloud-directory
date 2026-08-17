import type { MetadataRoute } from "next";
import { getArena, getBuildings } from "@/lib/db";
import { TECH } from "@/lib/tech";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = "http://100.65.31.68:3001";
  const now = new Date();
  const staticPages = ["", "/start", "/start/result", "/arena", "/compare", "/buildings", "/tech", "/about", "/methodology", "/correct"].map((path) => ({
    url: `${base}${path || "/"}`,
    lastModified: now,
  }));
  const [providers, buildings] = await Promise.all([getArena(), getBuildings()]);
  const listed = buildings.filter((b) => b.listed);
  return [
    ...staticPages,
    ...TECH.map((tech) => ({ url: `${base}/tech/${tech.slug}`, lastModified: now })),
    ...providers.map((p) => ({ url: `${base}/provider/${p.id}`, lastModified: now })),
    ...listed.map((b) => ({ url: `${base}/building/${b.id}`, lastModified: now })),
  ];
}
