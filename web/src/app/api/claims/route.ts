import { getCurrentClaims } from "@/lib/db";
import { apiJson, apiOptions } from "@/lib/api-json";
import { projectPublicCurrentClaim } from "../../../../../packages/domain/src/revisions/public-projection.ts";

export function OPTIONS() {
  return apiOptions();
}

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const subjectType = params.get("subjectType")?.trim() ?? "";
  const subjectId = params.get("subjectId")?.trim() ?? "";
  if (!subjectType || !subjectId) {
    return apiJson({ ok: false, error: "subjectType and subjectId are required" }, 400);
  }
  const claims = await getCurrentClaims(subjectType, subjectId);
  return apiJson({ ok: true, claims: claims.map(projectPublicCurrentClaim) });
}
