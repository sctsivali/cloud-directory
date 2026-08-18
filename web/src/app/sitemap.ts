import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const paths = [
    "",
    "/updates",
    "/start",
    "/arena",
    "/buildings",
    "/tech",
    "/about",
    "/methodology",
  ];
  return paths.map((p) => ({
    url: `https://guide.cloudin.asia${p || "/"}`,
    lastModified: now,
    changeFrequency: p === "/updates" ? "hourly" : "daily",
    priority: p === "" ? 1 : p === "/updates" ? 0.8 : 0.6,
  }));
}
