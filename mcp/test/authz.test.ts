import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PROPOSAL_TOOLS,
  PUBLICATION_TOOLS,
  READ_TOOLS,
} from "../../packages/contracts/src/mcp.ts";
import {
  authorizeToolCall,
  discoverTools,
  dispatchAuthorizedTool,
} from "../src/authz.ts";

describe("MCP capability authorization", () => {
  it("filters discovery to the session capabilities", () => {
    const readOnly = discoverTools(["read"]);
    for (const name of READ_TOOLS) {
      assert.ok(readOnly.includes(name), name);
    }
    for (const name of PROPOSAL_TOOLS) {
      assert.equal(readOnly.includes(name), false, name);
    }
    assert.equal(readOnly.includes("directory.approve_proposal"), false);
    assert.equal(readOnly.includes("directory.publish_revision"), false);

    const proposeOnly = discoverTools(["propose"]);
    for (const name of PROPOSAL_TOOLS) {
      assert.ok(proposeOnly.includes(name), name);
    }
    assert.equal(proposeOnly.includes("directory.get_provider"), false);
    assert.equal(proposeOnly.includes("directory.publish_revision"), false);

    const collectOnly = discoverTools(["collect"]);
    assert.deepEqual(collectOnly, []);
  });

  it("discovers publication tools only when publish is explicitly granted", () => {
    const all = discoverTools(["read", "collect", "propose", "review", "approve", "publish", "verify"]);
    for (const name of PUBLICATION_TOOLS) {
      assert.ok(all.includes(name), name);
    }
    assert.ok(all.includes("directory.verify_publication"));
    const withoutPublish = discoverTools(["read", "collect", "propose", "review", "approve"]);
    for (const name of PUBLICATION_TOOLS) {
      assert.equal(withoutPublish.includes(name), false, name);
    }
  });

  it("rejects hidden tools invoked by direct name before the handler runs", async () => {
    const hidden = [
      "directory.propose_claim",
      "directory.approve_proposal",
      "directory.publish_revision",
      "directory.publish_change",
      "directory.verify_publication",
      "sql.execute",
      "directory.execute_sql",
    ];
    for (const name of hidden) {
      let ran = false;
      const result = await dispatchAuthorizedTool({
        capabilities: ["read"],
        name,
        args: {},
        handler: async () => {
          ran = true;
          return { ok: true, value: "should-not-run" };
        },
      });
      assert.equal(result.ok, false, name);
      assert.equal(ran, false, `${name} handler must not run`);
      assert.ok(result.code === "capability_missing" || result.code === "tool_unavailable", name);
    }
  });

  it("allows publication tools only after the publish capability gate", async () => {
    let ran = false;
    const denied = await dispatchAuthorizedTool({
      capabilities: ["read", "propose", "review", "approve"],
      name: "directory.publish_revision",
      args: { proposalId: "p-1" },
      handler: async () => {
        ran = true;
        return { ok: true, value: "published" };
      },
    });
    assert.equal(denied.ok, false);
    assert.equal(ran, false);

    const allowed = await dispatchAuthorizedTool({
      capabilities: ["publish"],
      name: "directory.publish_revision",
      args: { proposalId: "p-1" },
      handler: async () => {
        ran = true;
        return { ok: true, value: "published" };
      },
    });
    assert.equal(allowed.ok, true);
    assert.equal(ran, true);
    assert.equal(authorizeToolCall(["publish"], "directory.publish_change").allowed, true);
  });

  it("allows an authorized propose tool only after the authz gate", async () => {
    let ran = false;
    const denied = await dispatchAuthorizedTool({
      capabilities: ["read"],
      name: "directory.propose_retraction",
      args: {},
      handler: async () => {
        ran = true;
        return 1;
      },
    });
    assert.equal(denied.ok, false);
    assert.equal(ran, false);

    const allowed = await dispatchAuthorizedTool({
      capabilities: ["propose"],
      name: "directory.propose_retraction",
      args: {},
      handler: async () => {
        ran = true;
        return 2;
      },
    });
    assert.equal(allowed.ok, true);
    assert.equal(ran, true);
    if (allowed.ok) {
      assert.equal(allowed.value, 2);
    }
  });
});
