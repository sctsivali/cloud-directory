import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  MCP_CONTRACT_NAME,
  MCP_CONTRACT_VERSION,
  getToolDefinition,
  type Capability,
} from "../../packages/contracts/src/mcp.ts";
import { authorizeToolCall, discoverTools, dispatchAuthorizedTool } from "./authz.ts";
import { executeTool, type ToolContext } from "./handlers.ts";
import { parsePrincipalId } from "./principal.ts";
import { jsonSchemaToZod } from "./zod-schema.ts";

export type DirectoryMcpOptions = {
  capabilities: readonly Capability[];
  context: ToolContext;
};

export type DirectoryMcpHandle = {
  server: McpServer;
  capabilities: readonly Capability[];
  context: ToolContext;
  invoke: (name: string, args: unknown) => Promise<unknown>;
};

export function parseCapabilities(raw: string | undefined): Capability[] {
  const parts = (raw ?? "read")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const allowed: Capability[] = ["read", "collect", "propose", "review", "approve", "publish"];
  return parts.filter((part): part is Capability => (allowed as string[]).includes(part));
}

export function createDirectoryMcpServer(options: DirectoryMcpOptions): DirectoryMcpHandle {
  const principal = parsePrincipalId(options.context.principalId);
  if (!principal.ok) {
    throw new Error(principal.message);
  }
  const server = new McpServer({
    name: MCP_CONTRACT_NAME,
    version: MCP_CONTRACT_VERSION,
  });
  const visible = discoverTools(options.capabilities);

  const invoke = async (name: string, args: unknown) => {
    const gated = await dispatchAuthorizedTool({
      capabilities: options.capabilities,
      name,
      args,
      handler: async (input) => executeTool(options.context, name, input),
    });
    if (!gated.ok) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              ok: false,
              outcome: "rejected",
              code: gated.code,
              message: gated.message,
            }),
          },
        ],
        isError: true,
      };
    }
    return gated.value;
  };

  for (const name of visible) {
    const definition = getToolDefinition(name);
    if (!definition) continue;
    const inputSchema = jsonSchemaToZod(definition.inputSchema);
    server.registerTool(
      name,
      {
        title: name,
        description: definition.description,
        inputSchema,
      },
      async (args) => {
        const decision = authorizeToolCall(options.capabilities, name);
        if (!decision.allowed) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  ok: false,
                  outcome: "rejected",
                  code: decision.code,
                  message: decision.message,
                }),
              },
            ],
            isError: true,
          };
        }
        return executeTool(options.context, name, args);
      }
    );
  }

  return { server, capabilities: options.capabilities, context: options.context, invoke };
}

export async function connectStdio(handle: DirectoryMcpHandle): Promise<void> {
  const transport = new StdioServerTransport();
  await handle.server.connect(transport);
}
