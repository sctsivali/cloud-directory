import { fail, ok, requireNonEmpty, type ValidationResult } from "./validation.ts";

export const TECHNOLOGY_SCOPES = ["provider", "service", "offering", "deployment"] as const;

export type TechnologyScope = (typeof TECHNOLOGY_SCOPES)[number];

export type Technology = {
  id: string;
  slug: string;
  name: string;
  category: string;
};

export type TechnologyVersion = {
  id: string;
  technologyId: string;
  versionLabel: string;
};

export type TechnologyDeployment = {
  id: string;
  technologyId: string;
  technologyVersionId: string | null;
  scope: TechnologyScope;
  scopeId: string;
  hasUniversalScopeEvidence: boolean;
};

export type OfferingRef = {
  id: string;
  providerId: string;
  serviceId: string;
};

export function validateTechnology(tech: Technology): ValidationResult {
  const errors: string[] = [];
  for (const [field, value] of [
    ["id", tech.id],
    ["slug", tech.slug],
    ["name", tech.name],
    ["category", tech.category],
  ] as const) {
    const err = requireNonEmpty(value, field);
    if (err) errors.push(err);
  }
  if (errors.length) return fail(...errors);
  return ok();
}

export function validateTechnologyDeployment(row: TechnologyDeployment): ValidationResult {
  const errors: string[] = [];
  const idErr = requireNonEmpty(row.id, "id");
  if (idErr) errors.push(idErr);
  const techErr = requireNonEmpty(row.technologyId, "technologyId");
  if (techErr) errors.push(techErr);
  const scopeIdErr = requireNonEmpty(row.scopeId, "scopeId");
  if (scopeIdErr) errors.push(scopeIdErr);
  if (!(TECHNOLOGY_SCOPES as readonly string[]).includes(row.scope)) {
    errors.push(`unsupported scope: ${row.scope}`);
  }
  if (errors.length) return fail(...errors);
  return ok();
}

/**
 * Direct offering/deployment scope applies to that subject.
 * Provider or service scope inherits onto an offering only with explicit
 * universal-scope evidence.
 */
export function technologyAppliesToOffering(
  deployment: TechnologyDeployment,
  offering: OfferingRef
): boolean {
  if (deployment.scope === "offering") {
    return deployment.scopeId === offering.id;
  }
  if (deployment.scope === "deployment") {
    return false;
  }
  if (!deployment.hasUniversalScopeEvidence) {
    return false;
  }
  if (deployment.scope === "provider") {
    return deployment.scopeId === offering.providerId;
  }
  if (deployment.scope === "service") {
    return deployment.scopeId === offering.serviceId;
  }
  return false;
}
