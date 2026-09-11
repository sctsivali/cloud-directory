import assert from "node:assert/strict";
import { it } from "node:test";
import { registerHooks } from "node:module";
import { CURRENT_CLAIMS_AT_SQL } from "../../packages/domain/src/current-claims.ts";

it("GET /api/claims redacts sensitive table values and preserves public claims", async () => {
  const syntheticValue = "synthetic-claims-leak-canary";
  const sensitiveFields = ["password", "secret", "token", "credential", "private_key"];
  const rows = [...sensitiveFields, "hypervisor"].map((claim_type) => ({
    id: `test-${claim_type}`,
    subject_type: "provider",
    subject_id: "synthetic-provider",
    claim_type,
    value: { text: claim_type === "hypervisor" ? "KVM" : syntheticValue },
    knowledge_state: "present",
    assessment_state: "independently_verified",
  }));
  const globals = globalThis as unknown as { pool?: unknown };
  const oldPool = globals.pool;
  let queries = 0;
  globals.pool = {
    async query(sql: string, params: unknown[]) {
      assert.equal(sql, CURRENT_CLAIMS_AT_SQL);
      assert.deepEqual(params.slice(1), ["provider", "synthetic-provider"]);
      queries++;
      return { rows };
    },
  };
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
    const response = await GET(new Request("http://test.invalid/api/claims?subjectType=provider&subjectId=synthetic-provider"));
    assert.equal(response.status, 200);
    assert.equal(queries, 1);
    const body = await response.text();
    assert.ok(!body.includes(syntheticValue), "public GET /api/claims leaked the synthetic sensitive value");
    const api = JSON.parse(body);
    assert.equal(api.ok, true);
    assert.equal(api.claims.length, rows.length);
    for (const row of rows) {
      assert.deepEqual(api.claims.find((claim: { id: string }) => claim.id === row.id), {
        ...row,
        value: row.claim_type === "hypervisor" ? row.value : null,
        value_sensitivity: row.claim_type === "hypervisor" ? "public" : "redacted",
      });
    }
    assert.equal(rows[0]!.value.text, syntheticValue, "projection must not mutate database rows");
  } finally {
    hooks.deregister();
    globals.pool = oldPool;
  }
});
