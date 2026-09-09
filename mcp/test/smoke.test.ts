import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { READ_TOOLS } from "../../packages/contracts/src/mcp.ts";
import { dispatchAuthorizedTool } from "../src/authz.ts";
import { ERROR_CODE } from "../src/errors.ts";
import { createDirectoryMcpServer } from "../src/server.ts";
import { MemoryProposalRepository } from "../src/store.ts";
import type { DirectoryReader } from "../src/read-tools.ts";

function toolText(result: unknown): string {
  const record = result as { content?: unknown };
  const content = record.content;
  if (!Array.isArray(content) || content.length === 0) {
    throw new Error("missing tool content");
  }
  const first = content[0] as { text?: string };
  if (typeof first.text !== "string") {
    throw new Error("missing tool text");
  }
  return first.text;
}

const reader: DirectoryReader = {
  async getProvider(id) {
    return id === "local-packages" ? { id, name: "Local Packages" } : null;
  },
  async searchProviders() {
    return [{ id: "local-packages", name: "Local Packages" }];
  },
  async getOfferings() {
    return [];
  },
  async getClaims() {
    return [];
  },
  async getEvidence() {
    return [];
  },
  async getSourceSnapshot() {
    return null;
  },
  async explainScore(providerId) {
    return { engine: "legacy", providerId };
  },
  async getQualityReport() {
    return { claimCount: 0, evidenceCount: 0, snapshotCount: 0 };
  },
};

async function connectedClient(capabilities: Parameters<typeof createDirectoryMcpServer>[0]["capabilities"]) {
  const handle = createDirectoryMcpServer({
    capabilities,
    context: { reader, repo: new MemoryProposalRepository(), principalId: "worker-a" },
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "phase3-smoke", version: "1.0.0" });
  await handle.server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, handle };
}

describe("MCP in-memory smoke", () => {
  it("lists only authorized Phase 3 tools and serves a read", async () => {
    const { client } = await connectedClient(["read"]);
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name);
    for (const name of READ_TOOLS) {
      assert.ok(names.includes(name), name);
    }
    assert.equal(names.includes("directory.propose_claim"), false);
    assert.equal(names.includes("directory.publish_revision"), false);
    assert.equal(names.includes("directory.verify_publication"), false);
    const got = await client.callTool({
      name: "directory.get_provider",
      arguments: { id: "local-packages" },
    });
    const text = toolText(got);
    assert.match(text, /local-packages/);
    await client.close();
  });

  it("rejects a hidden publication tool at the protocol boundary", async () => {
    const { client, handle } = await connectedClient(["read", "propose"]);
    const listed = await client.listTools();
    assert.equal(
      listed.tools.some((tool) => tool.name.startsWith("directory.publish_")),
      false
    );
    const hidden = await client.callTool({
      name: "directory.publish_revision",
      arguments: { proposalId: "p-1" },
    });
    assert.equal(hidden.isError, true);
    assert.match(toolText(hidden), /not found|unavailable/i);
    const direct = await handle.invoke("directory.publish_revision", { proposalId: "p-1" });
    const payload = JSON.parse((direct as { content: { text: string }[] }).content[0].text);
    assert.equal(payload.ok, false);
    assert.ok(payload.code === "tool_unavailable" || payload.code === "capability_missing");
    let ran = false;
    const gated = await dispatchAuthorizedTool({
      capabilities: ["read", "propose"],
      name: "directory.publish_change",
      args: { revisionId: "r-1" },
      handler: async () => {
        ran = true;
        return { ok: true };
      },
    });
    assert.equal(gated.ok, false);
    assert.equal(ran, false);
    await client.close();
  });

  it("creates a proposal through an authorized session", async () => {
    const { client } = await connectedClient(["propose"]);
    const result = await client.callTool({
      name: "directory.propose_retraction",
      arguments: {
        idempotencyKey: "ret-1",
        claimId: "claim-1",
        reason: "source retracted the statement",
      },
    });
    const payload = JSON.parse(toolText(result));
    assert.equal(payload.outcome, "created");
    assert.equal(payload.proposal.status, "pending_review");
    await client.close();
  });
});

describe("publication tools stay unreachable without publish", () => {
  it("does not run a publication handler without the publish capability", async () => {
    let ran = false;
    const result = await dispatchAuthorizedTool({
      capabilities: ["read", "propose", "review", "approve"],
      name: "directory.publish_revision",
      args: {},
      handler: async () => {
        ran = true;
        return ERROR_CODE.toolUnavailable;
      },
    });
    assert.equal(result.ok, false);
    assert.equal(ran, false);
  });
});
