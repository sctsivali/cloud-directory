import assert from "node:assert/strict";
import { it } from "node:test";
import { registerHooks } from "node:module";
import { TEST_DATABASE_URL, withMigratedDatabase } from "./pg-harness.ts";
import { PostgresDirectoryReader } from "../src/read-tools.ts";
import { executeTool } from "../src/handlers.ts";

it("L7 API/MCP current claims follow chain, drop cycles, and emit conflict", { skip: !TEST_DATABASE_URL }, async () => {
  await withMigratedDatabase(async (client, pool) => {
    async function insert(
      id: string,
      value: string,
      extras: {
        assessment?: string;
        observed?: string;
        recorded?: string;
        validFrom?: string | null;
        validTo?: string | null;
        supersededBy?: string | null;
        claimType?: string;
      } = {}
    ) {
      await client.query(
        `INSERT INTO claims (
           id, subject_type, subject_id, claim_type, value, knowledge_state, assessment_state,
           observed_at, recorded_at, valid_from, valid_to, superseded_by
         ) VALUES ($1,'provider','local-packages',$2,$3::jsonb,'present',$4,$5,$6,$7,$8,$9)`,
        [
          id,
          extras.claimType ?? "hypervisor",
          JSON.stringify({ text: value }),
          extras.assessment ?? "extracted",
          extras.observed ?? "2026-06-01T00:00:00Z",
          extras.recorded ?? "2026-01-01T00:00:00Z",
          extras.validFrom ?? null,
          extras.validTo ?? null,
          extras.supersededBy ?? null,
        ]
      );
    }

    await insert("head", "KVM", { assessment: "independently_verified", observed: "2026-01-01T00:00:00Z", recorded: "2022-01-01T00:00:00Z" });
    await insert("middle", "ESXi", { observed: "2025-01-01T00:00:00Z", recorded: "2021-01-01T00:00:00Z", supersededBy: "head" });
    await insert("first-recorded", "Xen", { observed: "2024-01-01T00:00:00Z", recorded: "2020-01-01T00:00:00Z", supersededBy: "middle" });
    await insert("rejected", "no", { assessment: "rejected", observed: "2026-09-01T00:00:00Z", recorded: "2019-01-01T00:00:00Z" });
    await insert("expired", "old", { observed: "2020-01-01T00:00:00Z", recorded: "2019-02-01T00:00:00Z", validTo: "2021-01-01T00:00:00Z" });
    await insert("future", "later", { observed: "2026-09-09T00:00:00Z", recorded: "2019-03-01T00:00:00Z", validFrom: "2099-01-01T00:00:00Z" });
    await insert("cycle-a", "A", { claimType: "cycle", recorded: "2020-01-01T00:00:00Z" });
    await insert("cycle-b", "B", { claimType: "cycle", recorded: "2021-01-01T00:00:00Z" });
    await client.query("UPDATE claims SET superseded_by='cycle-b' WHERE id='cycle-a'");
    await client.query("UPDATE claims SET superseded_by='cycle-a' WHERE id='cycle-b'");
    await insert("src-kvm", "KVM", { claimType: "region", assessment: "independently_verified", observed: "2026-04-01T00:00:00Z", recorded: "2026-04-02T00:00:00Z" });
    await insert("src-xen", "Xen", { claimType: "region", assessment: "independently_verified", observed: "2026-05-01T00:00:00Z", recorded: "2026-05-02T00:00:00Z" });
    await insert("claim-a", "KVM", { claimType: "storage", assessment: "independently_verified", observed: "2026-06-01T00:00:00Z", recorded: "2020-01-01T00:00:00Z" });
    await insert("claim-z", "KVM", { claimType: "storage", assessment: "independently_verified", observed: "2026-06-01T00:00:00Z", recorded: "2026-09-01T00:00:00Z" });

    const globals = globalThis as unknown as { pool?: unknown };
    const old = globals.pool;
    globals.pool = { query: client.query.bind(client) };
    const hooks = registerHooks({
      resolve(specifier, context, nextResolve) {
        if (specifier.startsWith("@/")) {
          return nextResolve(new URL(`../../web/src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
        }
        if (specifier === "next/server") return nextResolve("next/server.js", context);
        if (specifier === "./legacy-scoring") return nextResolve("./legacy-scoring.ts", context);
        return nextResolve(specifier, context);
      },
    });
    try {
      const { GET } = await import(new URL("../../web/src/app/api/claims/route.ts", import.meta.url).href) as {
        GET(req: Request): Promise<Response>;
      };
      const apiRes = await GET(new Request("http://test.invalid/api/claims?subjectType=provider&subjectId=local-packages"));
      assert.equal(apiRes.status, 200);
      const api = await apiRes.json() as { ok: boolean; claims: Array<{ id: string; claim_type: string; knowledge_state: string; value: { text?: string } | null; assessment_state: string }> };
      const byType = Object.fromEntries(api.claims.map((row) => [row.claim_type, row]));
      assert.equal(byType.hypervisor?.id, "head");
      assert.equal(byType.hypervisor?.value?.text, "KVM");
      assert.equal(byType.hypervisor?.assessment_state, "independently_verified");
      assert.equal(byType.cycle, undefined);
      assert.equal(byType.region?.knowledge_state, "conflicting");
      assert.equal(byType.region?.value, null);
      assert.equal(byType.storage?.id, "claim-z");
      assert.ok(!api.claims.some((row) => row.id === "first-recorded" || row.id === "rejected" || row.id === "expired" || row.id === "future"));

      const reader = new PostgresDirectoryReader(client);
      const mcpRows = await reader.getClaims("provider", "local-packages");
      const mcpByType = Object.fromEntries(mcpRows.filter((row) => row.claim_type).map((row) => [String(row.claim_type), row]));
      assert.equal(mcpByType.hypervisor?.id, "head");
      assert.equal((mcpByType.region as { knowledge_state?: string })?.knowledge_state, "conflicting");
      const tool = JSON.parse((await executeTool({ reader, repo: null, principalId: "reader", capabilities: ["read"] }, "directory.get_claims", { subjectType: "provider", subjectId: "local-packages" })).content[0]!.text);
      assert.equal(tool.ok, true);
      const toolHypervisor = tool.claims.find((row: { claim_type?: string }) => row.claim_type === "hypervisor");
      assert.equal(toolHypervisor.id, "head");
    } finally {
      hooks.deregister();
      globals.pool = old;
    }
  });
});
