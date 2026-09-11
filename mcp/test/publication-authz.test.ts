import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PUBLICATION_TOOLS, READ_TOOLS } from "../../packages/contracts/src/mcp.ts";
import {
  authorizeToolCall,
  discoverTools,
  dispatchAuthorizedTool,
} from "../src/authz.ts";
import { executeTool } from "../src/handlers.ts";
import { createDirectoryMcpServer } from "../src/server.ts";
import { MemoryProposalRepository } from "../src/store.ts";

describe("publication MCP authorization", () => {
  it("hides publication tools from default, read, and propose sessions", () => {
    const sessions: Array<readonly ("read" | "collect" | "propose" | "review" | "approve" | "publish" | "verify")[]> = [
      ["read"],
      ["propose"],
      ["read", "propose"],
      ["read", "collect", "propose", "review", "approve"],
    ];
    for (const caps of sessions) {
      const visible = discoverTools(caps);
      for (const name of PUBLICATION_TOOLS) {
        assert.equal(visible.includes(name), false, `${caps.join(",")} must not discover ${name}`);
        assert.equal(authorizeToolCall(caps, name).allowed, false, `${caps.join(",")} must not invoke ${name}`);
      }
    }
  });

  it("registers publication tools only when publish is explicitly granted", () => {
    const visible = discoverTools(["publish"]);
    for (const name of PUBLICATION_TOOLS) {
      assert.ok(visible.includes(name), name);
    }
    for (const name of READ_TOOLS) {
      assert.equal(visible.includes(name), false, name);
    }
    const mixed = discoverTools(["read", "propose", "publish"]);
    assert.ok(mixed.includes("directory.publish_revision"));
    assert.ok(mixed.includes("directory.get_provider"));
  });

  it("rejects hidden publication tools by direct name before the handler runs", async () => {
    for (const name of PUBLICATION_TOOLS) {
      let ran = false;
      const result = await dispatchAuthorizedTool({
        capabilities: ["read", "propose"],
        name,
        args: { proposalId: "p-1" },
        handler: async () => {
          ran = true;
          return { ok: true };
        },
      });
      assert.equal(result.ok, false, name);
      assert.equal(ran, false, name);
      assert.ok(result.code === "capability_missing" || result.code === "tool_unavailable", name);
    }
  });

  it("enforces handler-level publish capability even when dispatch is bypassed", async () => {
    const repo = new MemoryProposalRepository();
    const denied = await executeTool(
      { reader: null, repo, principalId: "publisher-1", capabilities: ["read", "propose"] },
      "directory.publish_revision",
      {
        proposalId: "p-1",
        expectedRevisionId: "r-1",
        expectedBodyDigest: "a".repeat(64),
        idempotencyKey: "k-1",
        methodologyVersion: "asean-offering-deployment-v1",
        dataRevision: "drv-1",
      }
    );
    const payload = JSON.parse(denied.content[0].text) as { code?: string; ok?: boolean };
    assert.equal(payload.ok, false);
    assert.ok(payload.code === "capability_missing" || payload.code === "tool_unavailable");
  });

  it("does not register publication tools on a default read server", () => {
    const handle = createDirectoryMcpServer({
      capabilities: ["read"],
      context: { reader: null, repo: new MemoryProposalRepository(), principalId: "reader-1" },
    });
    const names = discoverTools(handle.capabilities);
    for (const name of PUBLICATION_TOOLS) {
      assert.equal(names.includes(name), false, name);
    }
  });

  it("hides verify_publication unless verify is explicitly granted", async () => {
    const hiddenFrom = [
      ["read"],
      ["publish"],
      ["read", "propose", "review", "approve", "publish"],
    ] as const;
    for (const caps of hiddenFrom) {
      assert.equal(discoverTools(caps).includes("directory.verify_publication"), false, caps.join(","));
      assert.equal(authorizeToolCall(caps, "directory.verify_publication").allowed, false, caps.join(","));
    }
    assert.ok(discoverTools(["verify"]).includes("directory.verify_publication"));
    const denied = await executeTool(
      { reader: null, repo: new MemoryProposalRepository(), principalId: "verifier-1", capabilities: ["publish"] },
      "directory.verify_publication",
      {
        receiptId: "rcpt-1",
        eventId: "evt-1",
        expectedValueDigest: "a".repeat(64),
        expectedDataRevision: "drv-1",
      }
    );
    const payload = JSON.parse(denied.content[0].text) as { code?: string; ok?: boolean };
    assert.equal(payload.ok, false);
    assert.ok(payload.code === "capability_missing" || payload.code === "tool_unavailable");
  });
});
