import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CAPABILITIES,
  FORBIDDEN_TOOL_NAMES,
  MCP_CONTRACT_NAME,
  MCP_CONTRACT_VERSION,
  PHASE3_AVAILABLE_TOOLS,
  PHASE3_UNAVAILABLE_TOOLS,
  PROPOSAL_TOOLS,
  PUBLICATION_TOOLS,
  READ_TOOLS,
  REVIEW_TOOLS,
  TOOL_CATALOG,
  capabilityForTool,
  isPhase3AvailableTool,
  validateToolInput,
} from "../src/mcp.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("versioned MCP contract", () => {
  it("pins a named contract version distinct from the web API", () => {
    assert.equal(MCP_CONTRACT_NAME, "cloud-directory-mcp");
    assert.match(MCP_CONTRACT_VERSION, /^\d+\.\d+\.\d+$/);
    assert.equal(TOOL_CATALOG.contractVersion, MCP_CONTRACT_VERSION);
    assert.equal(TOOL_CATALOG.schemaVersion, 7);
  });

  it("lists the Phase 3 read tools", () => {
    assert.deepEqual([...READ_TOOLS], [
      "directory.get_provider",
      "directory.search_providers",
      "directory.get_offerings",
      "directory.get_claims",
      "directory.get_evidence",
      "directory.get_source_snapshot",
      "directory.explain_score",
      "directory.get_quality_report",
    ]);
  });

  it("lists proposal-only mutation tools", () => {
    assert.deepEqual([...PROPOSAL_TOOLS], [
      "directory.propose_claim",
      "directory.propose_offering",
      "directory.propose_price_observation",
      "directory.propose_location",
      "directory.propose_facility",
      "directory.propose_technology_deployment",
      "directory.propose_retraction",
    ]);
  });

  it("does not expose generic SQL or arbitrary field mutation", () => {
    const names = TOOL_CATALOG.tools.map((tool) => tool.name);
    for (const banned of FORBIDDEN_TOOL_NAMES) {
      assert.equal(names.includes(banned), false, banned);
    }
    for (const tool of TOOL_CATALOG.tools) {
      assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
      assert.equal("sql" in tool.inputSchema.properties, false, tool.name);
      assert.equal("query" in tool.inputSchema.properties, false, tool.name);
      assert.equal("fields" in tool.inputSchema.properties, false, tool.name);
    }
  });

  it("keeps publication tools in the reserved set and out of Phase 3 availability", () => {
    assert.ok(PUBLICATION_TOOLS.includes("directory.publish_revision"));
    for (const name of PUBLICATION_TOOLS) {
      assert.equal(isPhase3AvailableTool(name), false, name);
      assert.ok(PHASE3_UNAVAILABLE_TOOLS.includes(name));
    }
    for (const name of PHASE3_AVAILABLE_TOOLS) {
      assert.equal(PUBLICATION_TOOLS.includes(name as (typeof PUBLICATION_TOOLS)[number]), false);
    }
  });

  it("maps every catalog tool to a server-side capability", () => {
    assert.deepEqual([...CAPABILITIES], ["read", "collect", "propose", "review", "approve", "publish"]);
    for (const tool of TOOL_CATALOG.tools) {
      const cap = capabilityForTool(tool.name);
      assert.ok(CAPABILITIES.includes(cap), tool.name);
    }
    for (const name of READ_TOOLS) {
      assert.equal(capabilityForTool(name), "read");
    }
    for (const name of PROPOSAL_TOOLS) {
      assert.equal(capabilityForTool(name), "propose");
    }
    for (const name of REVIEW_TOOLS) {
      assert.ok(["review", "approve"].includes(capabilityForTool(name)), name);
    }
    for (const name of PUBLICATION_TOOLS) {
      assert.equal(capabilityForTool(name), "publish");
    }
  });

  it("rejects malformed propose_claim payloads at the contract boundary", () => {
    const ok = validateToolInput("directory.propose_claim", {
      idempotencyKey: "k1",
      subjectType: "provider",
      subjectId: "local-packages",
      claimType: "hypervisor",
      value: { text: "KVM" },
      knowledgeState: "present",
      assessmentState: "extracted",
    });
    assert.equal(ok.ok, true);
    const spoofed = validateToolInput("directory.propose_claim", {
      idempotencyKey: "k1",
      actorId: "worker-a",
      subjectType: "provider",
      subjectId: "local-packages",
      claimType: "hypervisor",
      value: { text: "KVM" },
      knowledgeState: "present",
      assessmentState: "extracted",
    });
    assert.equal(spoofed.ok, false);
    const sql = validateToolInput("directory.propose_claim", {
      idempotencyKey: "k1",
      actorId: "worker-a",
      sql: "DELETE FROM providers",
    });
    assert.equal(sql.ok, false);
    const empty = validateToolInput("directory.propose_claim", {});
    assert.equal(empty.ok, false);
  });

  it("is documented in docs/mcp-contract.md", () => {
    const doc = readFileSync(join(repoRoot, "docs", "mcp-contract.md"), "utf8");
    assert.match(doc, /cloud-directory-mcp/);
    assert.match(doc, /1\.0\.0/);
    for (const name of [...READ_TOOLS, ...PROPOSAL_TOOLS]) {
      assert.match(doc, new RegExp(name.replace(".", "\\.")));
    }
    assert.match(doc, /proposal-only/i);
    assert.match(doc, /publish/i);
    assert.match(doc, /unavailable|not available|Phase 3/i);
    assert.match(doc, /principalId/);
    assert.match(doc, /MCP_PRINCIPAL_ID/);
    assert.doesNotMatch(doc, /directory\.execute_sql/);
  });
});
