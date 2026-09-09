import assert from "node:assert/strict";
import { it } from "node:test";
import { registerHooks } from "node:module";
import { TEST_DATABASE_URL, withMigratedDatabase } from "./pg-harness.ts";
import {
  CURRENT_METHODOLOGY,
  LEGACY_ALGORITHM_VERSION,
  LEGACY_DATA_REVISION,
  LEGACY_METHODOLOGY_ID,
  LATEST_SCORING_RUN_FOR_IDENTITY_SQL,
  SCORE_COMPONENTS_FOR_RUNS_SQL,
} from "../../packages/domain/src/scoring/index.ts";

type ScoreBody = {
  sov_score: number;
  oss_score: number;
  conf_score: number;
  score_engine: string;
  algorithm_version: string;
  ruleset_hash: string;
  data_revision: string;
  methodology_id: string;
  scoring_run_id: string | null;
  offering_id: string | null;
  deployment_id: string | null;
  fallback_label: string | null;
  composite: number | null;
};

it("L6 arena/provider API numbers and metadata share one scoring_run and label SQL fallbacks", { skip: !TEST_DATABASE_URL }, async () => {
  await withMigratedDatabase(async (client, _pool) => {
    await client.query(`INSERT INTO providers (id, name, is_local_asean) VALUES ('prov-a', 'Alpha', true), ('prov-legacy', 'Legacy Co', true)`);
    async function insertRun(id: string, revision: string, composite: number, createdAt: string, raw: number) {
      await client.query(
        `INSERT INTO scoring_runs (
           id, methodology_id, algorithm_version, ruleset_hash, data_revision,
           subject_type, subject_id, offering_id, deployment_id, provider_id,
           recommendation_group, composite, ranking_lower_bound, uncertainty,
           reason_codes, engine, created_at
         ) VALUES (
           $1, $2, $3, $4, $5,
           'offering_deployment', 'off-a:dep-a', 'off-a', 'dep-a', 'prov-a',
           'eligible', $6, $6, 0.12, '{}', 'canonical', $7
         )`,
        [id, CURRENT_METHODOLOGY.id, CURRENT_METHODOLOGY.algorithmVersion, CURRENT_METHODOLOGY.rulesetHash, revision, composite, createdAt]
      );
      for (const [dimension, value] of [
        ["primary_data_residency", raw],
        ["backup_residency", raw],
        ["metadata_control_plane_residency", raw],
        ["contracting_entity_legal_control", raw],
        ["open_technology_portability", raw / 2],
        ["evidence_quality", raw / 4],
        ["evidence_coverage", raw / 4],
      ] as const) {
        await client.query(
          `INSERT INTO score_components (scoring_run_id, dimension, knowledge_state, value, weight, uncertainty, reason_codes)
           VALUES ($1, $2, 'present', $3, 10, 0.1, '{}')`,
          [id, dimension, value]
        );
      }
    }
    await insertRun("run-old", "rev-old", 0.11, "2026-01-01T00:00:00Z", 0.1);
    await insertRun("run-new", "rev-new", 0.88, "2026-02-01T00:00:00Z", 0.8);

    const latestNew = await client.query(LATEST_SCORING_RUN_FOR_IDENTITY_SQL, ["off-a", "dep-a", "rev-new", CURRENT_METHODOLOGY.id]);
    const latestOld = await client.query(LATEST_SCORING_RUN_FOR_IDENTITY_SQL, ["off-a", "dep-a", "rev-old", CURRENT_METHODOLOGY.id]);
    const missing = await client.query(LATEST_SCORING_RUN_FOR_IDENTITY_SQL, ["off-a", "dep-a", "rev-missing", CURRENT_METHODOLOGY.id]);
    assert.equal(latestNew.rows[0]?.id, "run-new");
    assert.equal(Number(latestNew.rows[0]?.composite), 0.88);
    assert.equal(latestOld.rows[0]?.id, "run-old");
    assert.equal(missing.rowCount, 0);
    const components = await client.query(SCORE_COMPONENTS_FOR_RUNS_SQL, [[latestNew.rows[0].id]]);
    assert.ok(components.rowCount && components.rowCount > 0);
    assert.ok(components.rows.every((row: { scoring_run_id: string }) => row.scoring_run_id === "run-new"));

    await client.query("SET jit = off");
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
      const listMod = await import(new URL("../../web/src/app/api/providers/route.ts", import.meta.url).href) as { GET(): Promise<Response> };
      const detailMod = await import(new URL("../../web/src/app/api/providers/[id]/route.ts", import.meta.url).href) as {
        GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response>;
      };
      const list = await listMod.GET();
      assert.equal(list.status, 200);
      const body = await list.json() as { providers: Array<ScoreBody & { id: string }> };
      const canonical = body.providers.find((row) => row.id === "prov-a");
      const fallback = body.providers.find((row) => row.id === "prov-legacy");
      assert.ok(canonical);
      assert.ok(fallback);
      assert.equal(canonical.score_engine, "canonical");
      assert.equal(canonical.scoring_run_id, "run-new");
      assert.equal(canonical.offering_id, "off-a");
      assert.equal(canonical.deployment_id, "dep-a");
      assert.equal(canonical.data_revision, "rev-new");
      assert.equal(canonical.methodology_id, CURRENT_METHODOLOGY.id);
      assert.equal(canonical.algorithm_version, CURRENT_METHODOLOGY.algorithmVersion);
      assert.equal(canonical.ruleset_hash, CURRENT_METHODOLOGY.rulesetHash);
      assert.equal(canonical.composite, 0.88);
      assert.equal(canonical.sov_score, 80);
      assert.equal(canonical.oss_score, 40);
      assert.equal(canonical.conf_score, 20);
      assert.equal(canonical.fallback_label, null);
      assert.notEqual(canonical.data_revision, "rev-old");

      assert.equal(fallback.score_engine, "legacy-fallback");
      assert.equal(fallback.scoring_run_id, null);
      assert.equal(fallback.methodology_id, LEGACY_METHODOLOGY_ID);
      assert.equal(fallback.algorithm_version, LEGACY_ALGORITHM_VERSION);
      assert.equal(fallback.data_revision, LEGACY_DATA_REVISION);
      assert.notEqual(fallback.ruleset_hash, CURRENT_METHODOLOGY.rulesetHash);
      assert.ok(fallback.fallback_label?.toLowerCase().includes("legacy"));
      assert.equal(fallback.sov_score, 0);
      assert.equal(fallback.composite, null);

      const detail = await detailMod.GET(new Request("http://test.invalid/api/providers/prov-a"), {
        params: Promise.resolve({ id: "prov-a" }),
      });
      assert.equal(detail.status, 200);
      const provider = await detail.json() as ScoreBody;
      assert.equal(provider.scoring_run_id, canonical.scoring_run_id);
      assert.equal(provider.sov_score, canonical.sov_score);
      assert.equal(provider.oss_score, canonical.oss_score);
      assert.equal(provider.conf_score, canonical.conf_score);
      assert.equal(provider.composite, canonical.composite);
      assert.equal(provider.score_engine, "canonical");
      assert.equal(provider.data_revision, "rev-new");
    } finally {
      hooks.deregister();
      globals.pool = old;
    }
  });
});
