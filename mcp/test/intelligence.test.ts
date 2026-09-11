import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FORBIDDEN_TOOL_NAMES,
  READ_TOOLS,
} from "../../packages/contracts/src/mcp.ts";
import { authorizeToolCall, dispatchAuthorizedTool } from "../src/authz.ts";
import { executeTool, type ToolContext } from "../src/handlers.ts";
import type { DirectoryReader } from "../src/read-tools.ts";
import {
  publicOutlookEligibilityView,
  publicTrendView,
  buildOutlook,
  buildProviderTimeline,
  buildTrendReport,
} from "../../packages/domain/src/intelligence/index.ts";
import { LONGITUDINAL_DATA_REVISION, LONGITUDINAL_WINDOW, longitudinalFacts } from "../../packages/domain/test/intelligence-fixtures.ts";
import { createDirectoryMcpServer } from "../src/server.ts";
import { PostgresDirectoryReader } from "../src/read-tools.ts";
import { TEST_DATABASE_URL, withMigratedDatabase } from "./pg-harness.ts";

const query = {
  facts: longitudinalFacts(),
  window: { ...LONGITUDINAL_WINDOW },
  countryCode: "ID" as const,
  dataRevision: LONGITUDINAL_DATA_REVISION,
};

const reader: DirectoryReader = {
  async getProvider() {
    return null;
  },
  async searchProviders() {
    return [];
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
  async explainScore() {
    return null;
  },
  async getQualityReport() {
    return {};
  },
  async getTrends(args) {
    const report = publicTrendView(buildTrendReport({ ...query, countryCode: args.country === "SG" ? "SG" : "ID", providerId: args.providerId ?? null }));
    return report;
  },
  async getTimeline(args) {
    if (args.providerId) return buildProviderTimeline({ ...query, providerId: args.providerId });
    return { error: "providerId or country is required" };
  },
  async getOutlookEligibility(args) {
    const metric = (args.metric ?? "provider_count_by_country") as "provider_count_by_country";
    return publicOutlookEligibilityView(buildOutlook(query, metric));
  },
};

const ctx: ToolContext = { reader, repo: null, principalId: "reader-1", capabilities: ["read"] };

function parse(result: { content: { type: string; text: string }[] }): Record<string, unknown> {
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

describe("MCP intelligence read tools", () => {
  it("discovers trends, timeline, and outlook eligibility under read", () => {
    for (const name of ["directory.get_trends", "directory.get_timeline", "directory.get_outlook_eligibility"]) {
      assert.ok((READ_TOOLS as readonly string[]).includes(name), name);
      assert.equal(authorizeToolCall(["read"], name).allowed, true);
    }
  });

  it("rejects forecast publication tools before a handler runs", async () => {
    for (const name of [...FORBIDDEN_TOOL_NAMES]) {
      let ran = false;
      const result = await dispatchAuthorizedTool({
        capabilities: ["read", "publish"],
        name,
        args: {},
        handler: async () => {
          ran = true;
          return { ok: true };
        },
      });
      assert.equal(result.ok, false, name);
      assert.equal(ran, false, name);
    }
  });

  it("returns trend series with provenance and no forecast", async () => {
    const badWindow = parse(await executeTool(ctx, "directory.get_trends", { windowStart: "yesterday", windowEnd: "2026-01-01T00:00:00.000Z" }));
    assert.equal(badWindow.ok, false);
    assert.equal(badWindow.code, "invalid_window");
    const result = parse(await executeTool(ctx, "directory.get_trends", { country: "ID" }));
    assert.equal(result.ok, true);
    assert.ok(result.methodologyHash);
    assert.equal(result.dataRevision, LONGITUDINAL_DATA_REVISION);
    assert.equal("forecast" in result, false);
  });

  it("returns outlook eligibility without a forecast payload", async () => {
    const result = parse(
      await executeTool(ctx, "directory.get_outlook_eligibility", { metric: "comparable_basket_price_index", country: "ID" })
    );
    assert.equal(result.forecastPublished, false);
    assert.equal(result.insufficientEvidence, true);
    assert.equal("pointEstimate" in result, false);
    assert.equal("forecast" in result, false);
  });

  it("filters timelines by provider", async () => {
    const result = parse(await executeTool(ctx, "directory.get_timeline", { providerId: "prov-a" }));
    assert.equal(result.kind, "provider_timeline");
    assert.equal(result.providerId, "prov-a");
  });
});

describe("PostgreSQL intelligence read stress", { skip: !TEST_DATABASE_URL }, () => {
  it("serves twenty concurrent trend reads after migration", async () => {
    await withMigratedDatabase(async (_client, pool) => {
      const handle = createDirectoryMcpServer({
        capabilities: ["read"],
        context: {
          reader: new PostgresDirectoryReader(pool),
          repo: null,
          principalId: "reader-1",
        },
      });
      const results = await Promise.all(
        Array.from({ length: 20 }, () => handle.invoke("directory.get_trends", {}))
      );
      assert.equal(results.length, 20);
      const payloads = results.map((row) => {
        const record = row as { content?: { text?: string }[] };
        return JSON.parse(String(record.content?.[0]?.text)) as Record<string, unknown>;
      });
      for (const payload of payloads) {
        assert.equal(payload.ok, true);
        assert.equal(payload.forecastPublished ?? false, false);
        assert.equal(payload.insufficientEvidence, true);
        assert.equal(payload.windowAvailable, false);
        assert.equal(payload.observationWindow, null);
        assert.equal(JSON.stringify(payload).includes("2025-01-01T00:00:00.000Z"), false);
        assert.deepEqual(payload.methodologyHash, payloads[0]?.methodologyHash);
      }
    });
  });
});
