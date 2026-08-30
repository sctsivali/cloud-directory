import { getDirectoryUpdates } from "@/lib/db";
import { apiJson, apiOptions } from "@/lib/api-json";

export function OPTIONS() {
  return apiOptions();
}

export async function GET() {
  const updates = await getDirectoryUpdates();
  return apiJson({
    count: updates.length,
    updates: updates.map((u) => ({
      ...u,
      href: u.href?.startsWith("http")
        ? u.href
        : u.href
          ? `https://guide.cloudin.asia${u.href}`
          : null,
    })),
  });
}
