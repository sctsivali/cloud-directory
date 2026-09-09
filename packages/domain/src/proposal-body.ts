import { PROPOSAL_TOOLS, validateToolInput } from "../../contracts/src/mcp.ts";
import { validateClaim } from "./claim-validation.ts";
import { validateOffering } from "./entity-validation.ts";
import { canAssignMapPrecision, validateFacility } from "./geography.ts";
import { validateTechnologyDeployment } from "./technology.ts";
import type { AssessmentState, KnowledgeState } from "./knowledge-state.ts";

const IDENTITY_FIELDS = ["actorId", "reviewerId", "publisherId", "verifierId"] as const;
const REVISION_METADATA_FIELDS = [
  "toolName",
  "idempotencyKey",
  "actorId",
  "reviewerId",
  "publisherId",
  "verifierId",
  "bodyDigest",
  "status",
  "proposalId",
  "revisionId",
  "createdAt",
  "updatedAt",
  "sql",
  "execute",
  "mutation",
  "fields",
  "queryText",
] as const;

const PLACEHOLDER_IDEMPOTENCY_KEY = "revision-revalidation";

export type ProposalBodyValidation =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; errors: string[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function collectForbiddenPaths(value: unknown, path: string, nestedIdentityOnly: boolean): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      collectForbiddenPaths(item, `${path}[${index}]`, nestedIdentityOnly)
    );
  }
  if (!isPlainObject(value)) return [];
  const hits: string[] = [];
  for (const [key, nested] of Object.entries(value)) {
    const next = path ? `${path}.${key}` : key;
    const identity = (IDENTITY_FIELDS as readonly string[]).includes(key);
    const metadata = (REVISION_METADATA_FIELDS as readonly string[]).includes(key);
    if (path) {
      if (identity || key === "toolName") hits.push(next);
    } else if (nestedIdentityOnly) {
      if (identity || key === "toolName" || metadata) hits.push(next);
    } else if (metadata) {
      hits.push(next);
    }
    hits.push(...collectForbiddenPaths(nested, next, nestedIdentityOnly));
  }
  return hits;
}

function extraDomainErrors(toolName: string, input: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (toolName === "directory.propose_claim") {
    const result = validateClaim({
      subjectType: input.subjectType as never,
      subjectId: String(input.subjectId ?? ""),
      claimType: String(input.claimType ?? ""),
      value: input.value,
      knowledgeState: input.knowledgeState as KnowledgeState,
      assessmentState: input.assessmentState as AssessmentState,
      observedAt: typeof input.observedAt === "string" ? input.observedAt : null,
      recordedAt: new Date().toISOString(),
      validFrom: null,
      validTo: null,
    });
    if (!result.ok) errors.push(...result.errors);
  }
  if (toolName === "directory.propose_offering") {
    const result = validateOffering({
      id: "proposed",
      providerId: String(input.providerId ?? ""),
      serviceId: String(input.serviceId ?? ""),
      name: String(input.name ?? ""),
      status: typeof input.status === "string" ? input.status : null,
    });
    if (!result.ok) errors.push(...result.errors);
  }
  if (toolName === "directory.propose_location") {
    const precision = typeof input.mapPrecision === "string" ? input.mapPrecision : "undisclosed";
    const hasCoordinates = typeof input.lat === "number" && typeof input.lng === "number";
    if (
      precision === "facility_exact" &&
      !canAssignMapPrecision({
        requested: "facility_exact",
        evidenceKind: "city_name_only",
        hasCoordinates,
      })
    ) {
      errors.push("city-only location cannot request facility_exact");
    }
  }
  if (toolName === "directory.propose_facility") {
    const precision = typeof input.mapPrecision === "string" ? input.mapPrecision : "undisclosed";
    const result = validateFacility({
      id: "proposed",
      name: String(input.name ?? ""),
      locationId: typeof input.locationId === "string" ? input.locationId : null,
      address: typeof input.address === "string" ? input.address : null,
      operator: typeof input.operator === "string" ? input.operator : null,
      lat: typeof input.lat === "number" ? input.lat : null,
      lng: typeof input.lng === "number" ? input.lng : null,
      mapPrecision: precision as never,
    });
    if (!result.ok) errors.push(...result.errors);
  }
  if (toolName === "directory.propose_technology_deployment") {
    const result = validateTechnologyDeployment({
      id: "proposed",
      technologyId: String(input.technologyId ?? ""),
      technologyVersionId: typeof input.technologyVersionId === "string" ? input.technologyVersionId : null,
      scope: input.scope as never,
      scopeId: String(input.scopeId ?? ""),
      hasUniversalScopeEvidence: input.hasUniversalScopeEvidence === true,
    });
    if (!result.ok) errors.push(...result.errors);
  }
  if (toolName === "directory.propose_price_observation") {
    if (typeof input.amount === "number" && input.amount < 0) {
      errors.push("amount must not be negative");
    }
  }
  return errors;
}

export function isProposalToolName(name: string): boolean {
  return (PROPOSAL_TOOLS as readonly string[]).includes(name);
}

export function validateProposalFields(
  toolName: string,
  input: Record<string, unknown>
): ProposalBodyValidation {
  const contract = validateToolInput(toolName, input);
  if (!contract.ok) return { ok: false, errors: contract.errors };
  const domainErrors = extraDomainErrors(toolName, input);
  if (domainErrors.length) return { ok: false, errors: domainErrors };
  return { ok: true, body: input };
}

export function validateReplacementBody(
  toolName: string,
  body: unknown
): ProposalBodyValidation {
  if (!isProposalToolName(toolName)) {
    return { ok: false, errors: [`unknown proposal tool: ${toolName}`] };
  }
  if (!isPlainObject(body)) {
    return { ok: false, errors: ["replacement body must be an object"] };
  }
  const forbidden = collectForbiddenPaths(body, "", true);
  if (forbidden.length) {
    return { ok: false, errors: forbidden.map((field) => `forbidden field: ${field}`) };
  }
  return validateProposalFields(toolName, { idempotencyKey: PLACEHOLDER_IDEMPOTENCY_KEY, ...body });
}

export function validateStoredProposalBody(
  toolName: string,
  body: unknown
): ProposalBodyValidation {
  if (!isProposalToolName(toolName)) {
    return { ok: false, errors: [`unknown proposal tool: ${toolName}`] };
  }
  if (!isPlainObject(body)) {
    return { ok: false, errors: ["proposal body must be an object"] };
  }
  const storedTool = typeof body.toolName === "string" ? body.toolName : toolName;
  if (storedTool !== toolName) {
    return { ok: false, errors: ["toolName does not match the original proposal tool"] };
  }
  const nested = collectForbiddenPaths(body, "", false).filter(
    (field) => field !== "toolName" && field !== "idempotencyKey"
  );
  if (nested.length) {
    return { ok: false, errors: nested.map((field) => `forbidden field: ${field}`) };
  }
  const {
    toolName: _tool,
    idempotencyKey: _key,
    actorId: _actor,
    reviewerId: _reviewer,
    publisherId: _publisher,
    verifierId: _verifier,
    ...fields
  } = body;
  void _tool;
  void _key;
  void _actor;
  void _reviewer;
  void _publisher;
  void _verifier;
  return validateProposalFields(toolName, { idempotencyKey: PLACEHOLDER_IDEMPOTENCY_KEY, ...fields });
}
