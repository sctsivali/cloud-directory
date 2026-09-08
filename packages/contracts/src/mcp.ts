export const MCP_CONTRACT_NAME = "cloud-directory-mcp";
export const MCP_CONTRACT_VERSION = "1.0.0";
export const MCP_SCHEMA_VERSION = 8;

export const CAPABILITIES = [
  "read",
  "collect",
  "propose",
  "review",
  "approve",
  "publish",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export const READ_TOOLS = [
  "directory.get_provider",
  "directory.search_providers",
  "directory.get_offerings",
  "directory.get_claims",
  "directory.get_evidence",
  "directory.get_source_snapshot",
  "directory.explain_score",
  "directory.get_quality_report",
] as const;

export const PROPOSAL_TOOLS = [
  "directory.propose_claim",
  "directory.propose_offering",
  "directory.propose_price_observation",
  "directory.propose_location",
  "directory.propose_facility",
  "directory.propose_technology_deployment",
  "directory.propose_retraction",
] as const;

export const REVIEW_TOOLS = ["directory.review_proposal", "directory.approve_proposal"] as const;

export const WORKFLOW_READ_TOOLS = ["directory.get_proposal"] as const;

export const PUBLICATION_TOOLS = [
  "directory.publish_revision",
  "directory.publish_change",
] as const;

export const FORBIDDEN_TOOL_NAMES = [
  "sql.query",
  "sql.execute",
  "directory.execute_sql",
  "directory.mutate",
  "directory.update_fields",
  "directory.arbitrary_mutation",
] as const;

export type ReadToolName = (typeof READ_TOOLS)[number];
export type ProposalToolName = (typeof PROPOSAL_TOOLS)[number];
export type ReviewToolName = (typeof REVIEW_TOOLS)[number];
export type PublicationToolName = (typeof PUBLICATION_TOOLS)[number];
export type WorkflowReadToolName = (typeof WORKFLOW_READ_TOOLS)[number];
export type Phase3ToolName =
  | ReadToolName
  | ProposalToolName
  | ReviewToolName
  | WorkflowReadToolName;

export type JsonSchemaType = "string" | "number" | "integer" | "boolean" | "object" | "array";

export type JsonPropertySchema = {
  type: JsonSchemaType;
  minLength?: number;
  enum?: readonly string[];
  additionalProperties?: false;
};

export type JsonObjectSchema = {
  type: "object";
  additionalProperties: false;
  required: readonly string[];
  properties: Record<string, JsonPropertySchema>;
};

export type ToolDefinition = {
  name: string;
  capability: Capability;
  description: string;
  inputSchema: JsonObjectSchema;
  phase3Available: boolean;
};

const stringField: JsonPropertySchema = { type: "string", minLength: 1 };
const optionalString: JsonPropertySchema = { type: "string" };
const objectField: JsonPropertySchema = { type: "object", additionalProperties: false };

const KNOWLEDGE_STATES = [
  "present",
  "confirmed_absent",
  "unknown",
  "not_applicable",
  "conflicting",
] as const;

const ASSESSMENT_STATES = [
  "extracted",
  "inferred",
  "provider_asserted",
  "editorially_reviewed",
  "independently_verified",
  "rejected",
  "legacy/unverified",
] as const;

const SUBJECT_TYPES = [
  "provider",
  "legal_entity",
  "service",
  "offering",
  "offering_version",
  "location",
  "facility",
  "deployment",
  "technology",
  "technology_deployment",
] as const;

const MAP_PRECISIONS = [
  "facility_exact",
  "campus",
  "city_centroid",
  "region_centroid",
  "undisclosed",
] as const;

const TECH_SCOPES = ["provider", "service", "offering", "deployment"] as const;

function objectSchema(
  required: readonly string[],
  properties: Record<string, JsonPropertySchema>
): JsonObjectSchema {
  return {
    type: "object",
    additionalProperties: false,
    required,
    properties,
  };
}

const idempotentProposal = {
  idempotencyKey: stringField,
};

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: "directory.get_provider",
    capability: "read",
    description: "Read one provider by id from the canonical directory.",
    phase3Available: true,
    inputSchema: objectSchema(["id"], { id: stringField }),
  },
  {
    name: "directory.search_providers",
    capability: "read",
    description: "Search providers by name or country without mutating catalog facts.",
    phase3Available: true,
    inputSchema: objectSchema([], {
      name: optionalString,
      country: optionalString,
      limit: { type: "integer" },
    }),
  },
  {
    name: "directory.get_offerings",
    capability: "read",
    description: "Read offerings for a provider.",
    phase3Available: true,
    inputSchema: objectSchema(["providerId"], { providerId: stringField }),
  },
  {
    name: "directory.get_claims",
    capability: "read",
    description: "Read typed claims for a subject.",
    phase3Available: true,
    inputSchema: objectSchema(["subjectType", "subjectId"], {
      subjectType: { type: "string", enum: SUBJECT_TYPES },
      subjectId: stringField,
    }),
  },
  {
    name: "directory.get_evidence",
    capability: "read",
    description: "Read evidence rows linked to a claim or snapshot.",
    phase3Available: true,
    inputSchema: objectSchema([], {
      claimId: optionalString,
      snapshotId: optionalString,
      evidenceId: optionalString,
    }),
  },
  {
    name: "directory.get_source_snapshot",
    capability: "read",
    description: "Read an immutable fetch snapshot by id.",
    phase3Available: true,
    inputSchema: objectSchema(["id"], { id: stringField }),
  },
  {
    name: "directory.explain_score",
    capability: "read",
    description: "Explain the versioned offering/deployment score, or a labeled legacy fallback.",
    phase3Available: true,
    inputSchema: objectSchema(["providerId"], {
      providerId: stringField,
      offeringId: optionalString,
      deploymentId: optionalString,
    }),
  },
  {
    name: "directory.get_quality_report",
    capability: "read",
    description: "Read evidence-coverage quality counts. Does not change scores.",
    phase3Available: true,
    inputSchema: objectSchema([], { providerId: optionalString }),
  },
  {
    name: "directory.get_proposal",
    capability: "read",
    description: "Read a durable proposal by id or idempotency key.",
    phase3Available: true,
    inputSchema: objectSchema([], {
      proposalId: optionalString,
      idempotencyKey: optionalString,
    }),
  },
  {
    name: "directory.propose_claim",
    capability: "propose",
    description: "Submit a typed claim proposal. Never writes the canonical claim.",
    phase3Available: true,
    inputSchema: objectSchema(
      [
        "idempotencyKey",
        "subjectType",
        "subjectId",
        "claimType",
        "value",
        "knowledgeState",
        "assessmentState",
      ],
      {
        ...idempotentProposal,
        subjectType: { type: "string", enum: SUBJECT_TYPES },
        subjectId: stringField,
        claimType: stringField,
        value: objectField,
        knowledgeState: { type: "string", enum: KNOWLEDGE_STATES },
        assessmentState: { type: "string", enum: ASSESSMENT_STATES },
        observedAt: optionalString,
        snapshotId: optionalString,
        excerpt: optionalString,
      }
    ),
  },
  {
    name: "directory.propose_offering",
    capability: "propose",
    description: "Submit an offering proposal.",
    phase3Available: true,
    inputSchema: objectSchema(["idempotencyKey", "providerId", "serviceId", "name"], {
      ...idempotentProposal,
      providerId: stringField,
      serviceId: stringField,
      name: stringField,
      status: optionalString,
    }),
  },
  {
    name: "directory.propose_price_observation",
    capability: "propose",
    description: "Submit a price observation proposal.",
    phase3Available: true,
    inputSchema: objectSchema(
      ["idempotencyKey", "offeringId", "amount", "currency", "billingUnit"],
      {
        ...idempotentProposal,
        offeringId: stringField,
        amount: { type: "number" },
        currency: stringField,
        billingUnit: stringField,
        observedAt: optionalString,
        commitment: optionalString,
        promo: { type: "boolean" },
      }
    ),
  },
  {
    name: "directory.propose_location",
    capability: "propose",
    description: "Submit a location proposal. City-only evidence cannot request facility_exact.",
    phase3Available: true,
    inputSchema: objectSchema(["idempotencyKey", "city", "country"], {
      ...idempotentProposal,
      city: stringField,
      country: stringField,
      mapPrecision: { type: "string", enum: MAP_PRECISIONS },
      lat: { type: "number" },
      lng: { type: "number" },
    }),
  },
  {
    name: "directory.propose_facility",
    capability: "propose",
    description: "Submit a facility proposal.",
    phase3Available: true,
    inputSchema: objectSchema(["idempotencyKey", "name"], {
      ...idempotentProposal,
      name: stringField,
      locationId: optionalString,
      mapPrecision: { type: "string", enum: MAP_PRECISIONS },
      lat: { type: "number" },
      lng: { type: "number" },
      address: optionalString,
      operator: optionalString,
    }),
  },
  {
    name: "directory.propose_technology_deployment",
    capability: "propose",
    description: "Submit a scoped technology-deployment proposal.",
    phase3Available: true,
    inputSchema: objectSchema(
      ["idempotencyKey", "technologyId", "scope", "scopeId"],
      {
        ...idempotentProposal,
        technologyId: stringField,
        scope: { type: "string", enum: TECH_SCOPES },
        scopeId: stringField,
        hasUniversalScopeEvidence: { type: "boolean" },
        technologyVersionId: optionalString,
      }
    ),
  },
  {
    name: "directory.propose_retraction",
    capability: "propose",
    description: "Submit a retraction proposal for an existing claim.",
    phase3Available: true,
    inputSchema: objectSchema(["idempotencyKey", "claimId", "reason"], {
      ...idempotentProposal,
      claimId: stringField,
      reason: stringField,
    }),
  },
  {
    name: "directory.revise_proposal",
    capability: "propose",
    description: "Replace a proposal body. Approved proposals return to review.",
    phase3Available: true,
    inputSchema: objectSchema(["proposalId", "body"], {
      proposalId: stringField,
      body: objectField,
    }),
  },
  {
    name: "directory.review_proposal",
    capability: "review",
    description: "Record a non-approval review decision on a proposal.",
    phase3Available: true,
    inputSchema: objectSchema(["proposalId", "decision"], {
      proposalId: stringField,
      decision: { type: "string", enum: ["reject", "request_changes"] },
      comment: optionalString,
    }),
  },
  {
    name: "directory.approve_proposal",
    capability: "approve",
    description: "Approve a proposal. The proposer cannot self-approve.",
    phase3Available: true,
    inputSchema: objectSchema(["proposalId"], {
      proposalId: stringField,
      comment: optionalString,
    }),
  },
  {
    name: "directory.publish_revision",
    capability: "publish",
    description: "Reserved publication tool. Unavailable in Phase 3.",
    phase3Available: false,
    inputSchema: objectSchema(["proposalId"], { proposalId: stringField }),
  },
  {
    name: "directory.publish_change",
    capability: "publish",
    description: "Reserved publication tool. Unavailable in Phase 3.",
    phase3Available: false,
    inputSchema: objectSchema(["revisionId"], { revisionId: stringField }),
  },
];

export const TOOL_CATALOG = {
  contractName: MCP_CONTRACT_NAME,
  contractVersion: MCP_CONTRACT_VERSION,
  schemaVersion: MCP_SCHEMA_VERSION,
  tools: TOOL_DEFINITIONS,
} as const;

export const PHASE3_AVAILABLE_TOOLS = TOOL_DEFINITIONS.filter((tool) => tool.phase3Available).map(
  (tool) => tool.name
) as readonly string[];

export const PHASE3_UNAVAILABLE_TOOLS = TOOL_DEFINITIONS.filter((tool) => !tool.phase3Available).map(
  (tool) => tool.name
) as readonly string[];

const BY_NAME = new Map(TOOL_DEFINITIONS.map((tool) => [tool.name, tool]));

export function getToolDefinition(name: string): ToolDefinition | undefined {
  return BY_NAME.get(name);
}

export function isPhase3AvailableTool(name: string): boolean {
  return getToolDefinition(name)?.phase3Available === true;
}

export function capabilityForTool(name: string): Capability {
  const found = getToolDefinition(name);
  if (found) return found.capability;
  if ((PUBLICATION_TOOLS as readonly string[]).includes(name)) return "publish";
  throw new Error(`unknown tool: ${name}`);
}

export type ContractValidationResult = { ok: true } | { ok: false; errors: string[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function propertyOk(schema: JsonPropertySchema, value: unknown): boolean {
  if (value === undefined) return true;
  switch (schema.type) {
    case "string":
      if (typeof value !== "string") return false;
      if (schema.minLength != null && value.trim().length < schema.minLength) return false;
      if (schema.enum && !schema.enum.includes(value)) return false;
      return true;
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return isPlainObject(value);
    case "array":
      return Array.isArray(value);
    default:
      return false;
  }
}

const FORBIDDEN_INPUT_KEYS = [
  "sql",
  "execute",
  "mutation",
  "fields",
  "queryText",
  "actorId",
  "reviewerId",
] as const;

export function validateToolInput(name: string, input: unknown): ContractValidationResult {
  const tool = getToolDefinition(name);
  if (!tool) {
    return { ok: false, errors: [`unknown tool: ${name}`] };
  }
  if (!tool.phase3Available) {
    return { ok: false, errors: [`tool unavailable: ${name}`] };
  }
  if (!isPlainObject(input)) {
    return { ok: false, errors: ["payload must be an object"] };
  }
  const errors: string[] = [];
  for (const key of Object.keys(input)) {
    if ((FORBIDDEN_INPUT_KEYS as readonly string[]).includes(key)) {
      errors.push(`forbidden field: ${key}`);
    }
    if (!(key in tool.inputSchema.properties)) {
      errors.push(`unexpected field: ${key}`);
    }
  }
  for (const field of tool.inputSchema.required) {
    if (input[field] === undefined || input[field] === null) {
      errors.push(`${field} is required`);
      continue;
    }
    const prop = tool.inputSchema.properties[field];
    if (prop && !propertyOk(prop, input[field])) {
      errors.push(`${field} is invalid`);
    }
  }
  for (const [field, prop] of Object.entries(tool.inputSchema.properties)) {
    if (input[field] === undefined) continue;
    if (!propertyOk(prop, input[field])) {
      errors.push(`${field} is invalid`);
    }
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true };
}

export function toolsRequiringCapability(capability: Capability): string[] {
  return TOOL_DEFINITIONS.filter(
    (tool) => tool.phase3Available && tool.capability === capability
  ).map((tool) => tool.name);
}
