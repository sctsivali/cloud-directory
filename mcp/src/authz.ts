import {
  FORBIDDEN_TOOL_NAMES,
  TOOL_DEFINITIONS,
  capabilityForTool,
  getToolDefinition,
  isPhase3AvailableTool,
  type Capability,
} from "../../packages/contracts/src/mcp.ts";

export type AuthzCode = "capability_missing" | "tool_unavailable";

export type AuthzDecision =
  | { allowed: true }
  | { allowed: false; code: AuthzCode; message: string };

export type DispatchResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: AuthzCode; message: string };

export function authorizeToolCall(capabilities: readonly Capability[], name: string): AuthzDecision {
  if ((FORBIDDEN_TOOL_NAMES as readonly string[]).includes(name)) {
    return { allowed: false, code: "tool_unavailable", message: `tool unavailable: ${name}` };
  }
  const definition = getToolDefinition(name);
  if (!definition || !isPhase3AvailableTool(name)) {
    return { allowed: false, code: "tool_unavailable", message: `tool unavailable: ${name}` };
  }
  let required: ReturnType<typeof capabilityForTool>;
  try {
    required = capabilityForTool(name);
  } catch {
    return { allowed: false, code: "tool_unavailable", message: `tool unavailable: ${name}` };
  }
  if (required === "publish") {
    return { allowed: false, code: "tool_unavailable", message: `tool unavailable: ${name}` };
  }
  if (!capabilities.includes(required)) {
    return {
      allowed: false,
      code: "capability_missing",
      message: `missing capability ${required} for ${name}`,
    };
  }
  return { allowed: true };
}

export function discoverTools(capabilities: readonly Capability[]): string[] {
  return TOOL_DEFINITIONS.filter((tool) => authorizeToolCall(capabilities, tool.name).allowed).map(
    (tool) => tool.name
  );
}

export async function dispatchAuthorizedTool<T>(args: {
  capabilities: readonly Capability[];
  name: string;
  args: unknown;
  handler: (input: unknown) => Promise<T> | T;
}): Promise<DispatchResult<T>> {
  const decision = authorizeToolCall(args.capabilities, args.name);
  if (!decision.allowed) {
    return { ok: false, code: decision.code, message: decision.message };
  }
  const value = await args.handler(args.args);
  return { ok: true, value };
}
