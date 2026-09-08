import { Pool } from "./pg.ts";
import { requirePrincipalId } from "./principal.ts";
import { parseCapabilities, createDirectoryMcpServer, connectStdio } from "./server.ts";
import { PostgresDirectoryReader } from "./read-tools.ts";
import { PostgresProposalRepository } from "./pg-store.ts";

const principalId = requirePrincipalId(process.env.MCP_PRINCIPAL_ID);

function databaseUrl(): string {
  const url = process.env.MCP_DATABASE_URL || process.env.TEST_DATABASE_URL || "";
  if (!url.trim()) {
    throw new Error("MCP_DATABASE_URL or TEST_DATABASE_URL is required; DATABASE_URL is not used");
  }
  return url;
}

const pool = new Pool({ connectionString: databaseUrl() });
let poolClosed = false;

async function closePool(): Promise<void> {
  if (poolClosed) return;
  poolClosed = true;
  await pool.end();
}

const handle = createDirectoryMcpServer({
  capabilities: parseCapabilities(process.env.MCP_CAPABILITIES),
  context: {
    reader: new PostgresDirectoryReader(pool),
    repo: new PostgresProposalRepository(pool),
    principalId,
  },
});

process.once("SIGINT", () => {
  void closePool().finally(() => process.exit(0));
});
process.once("SIGTERM", () => {
  void closePool().finally(() => process.exit(0));
});
process.stdin.once("end", () => {
  void closePool();
});
process.stdin.once("close", () => {
  void closePool();
});

try {
  await connectStdio(handle);
} catch (err) {
  await closePool();
  throw err;
}
