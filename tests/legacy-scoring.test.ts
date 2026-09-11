import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LEGACY_DEFAULT_FX,
  LEGACY_OSS_SQL,
  compareLegacyValues,
  legacyUsdMonth,
  orderLikeGetArena,
  rankArenaRows,
  scoreLegacyProvider,
  toLegacyArenaRow,
} from "../web/src/lib/legacy-scoring.ts";
import { loadJson, loadProviderFixtures } from "./load-fixtures.ts";

type ScoreSnap = {
  blessed_for_new_engine: boolean;
  scores: Record<
    string,
    {
      sov: number;
      conf: number;
      oss: number;
      min_price: number | null;
      loc_count: number;
      max_vcpu: number | null;
      max_ram: number | null;
      components: ReturnType<typeof scoreLegacyProvider>["components"];
    }
  >;
  arena: Record<string, string[]>;
  pricing_probes: { unsupported_lak_80000: number; php_56000: number; usd_8_5: number };
};

describe("legacy scoring (production functions)", () => {
  const providers = loadProviderFixtures();
  const snap = loadJson<ScoreSnap>("legacy-scores.json");

  it("does not bless the snapshot as the future engine", () => {
    assert.equal(snap.blessed_for_new_engine, false);
    for (const row of Object.values(snap.scores)) {
      assert.equal("blessed_for_new_engine" in row ? (row as { blessed_for_new_engine?: boolean }).blessed_for_new_engine : false, false);
    }
  });

  it("reproduces frozen SOV, CONF, OSS and Arena metrics from scoreLegacyProvider", () => {
    for (const p of providers) {
      const got = scoreLegacyProvider(p);
      const row = toLegacyArenaRow(p);
      const exp = snap.scores[p.id];
      assert.ok(exp, p.id);
      assert.deepEqual(
        { sov: got.sov, conf: got.conf, oss: got.oss, components: got.components },
        { sov: exp.sov, conf: exp.conf, oss: exp.oss, components: exp.components },
        p.id
      );
      assert.deepEqual(
        { min_price: row.min_price, loc_count: row.loc_count, max_vcpu: row.max_vcpu, max_ram: row.max_ram },
        { min_price: exp.min_price, loc_count: exp.loc_count, max_vcpu: exp.max_vcpu, max_ram: exp.max_ram },
        p.id
      );
    }
  });

  it("reproduces Arena ordering through rankArenaRows", () => {
    const rows = orderLikeGetArena(providers.map(toLegacyArenaRow));
    assert.deepEqual(rows.map((r) => r.id), snap.arena.fetch_order);
    assert.deepEqual(rankArenaRows(rows, "sov", "asean", "all").map((r) => r.id), snap.arena.sov_asean);
    assert.deepEqual(rankArenaRows(rows, "oss", "asean", "all").map((r) => r.id), snap.arena.oss_asean);
    assert.deepEqual(rankArenaRows(rows, "conf", "asean", "all").map((r) => r.id), snap.arena.conf_asean);
    assert.deepEqual(rankArenaRows(rows, "cost", "all", "all").map((r) => r.id), snap.arena.cost_all);
    assert.deepEqual(rankArenaRows(rows, "cover", "asean", "all").map((r) => r.id), snap.arena.cover_asean);
    assert.deepEqual(rankArenaRows(rows, "perf", "asean", "all").map((r) => r.id), snap.arena.perf_asean);
    assert.deepEqual(rankArenaRows(rows, "sov", "asean", "Brunei").map((r) => r.id), snap.arena.brunei_hard);
  });

  it("captures compare values from the same scored rows CompareView displays", () => {
    const rows = orderLikeGetArena(providers.map(toLegacyArenaRow));
    const values = compareLegacyValues(rows, ["local-packages", "multi-region"]);
    const shortlists = loadJson<{
      cases: { "compare-top-sov": { values: unknown } };
    }>("legacy-shortlists.json");
    assert.deepEqual(values, shortlists.cases["compare-top-sov"].values);
  });

  it("records unsupported-currency IDR fallback without blessing it", () => {
    assert.equal(LEGACY_DEFAULT_FX, 16000);
    assert.equal(legacyUsdMonth(80000, "LAK"), snap.pricing_probes.unsupported_lak_80000);
    assert.equal(legacyUsdMonth(80000, "LAK"), 5);
    assert.equal(legacyUsdMonth(56000, "PHP"), 1000);
    assert.equal(legacyUsdMonth(8.5, "USD"), 8.5);
  });

  it("shows current defects: hedged and negated KVM still receive OSS credit", () => {
    const hedged = providers.find((p) => p.id === "local-no-packages")!;
    const negated = providers.find((p) => p.id === "kvm-negated")!;
    assert.match(hedged.stack?.hypervisor ?? "", /likely/i);
    assert.match(negated.stack?.hypervisor ?? "", /do not use KVM/i);
    assert.equal(scoreLegacyProvider(hedged).oss, 30);
    assert.equal(scoreLegacyProvider(negated).oss, 30);
    assert.equal(scoreLegacyProvider(hedged).components.conf.hypervisor, 0);
    assert.equal(scoreLegacyProvider(negated).components.conf.hypervisor, 20);
  });

  it("shows current defect: any source URL credits CONF, including 404 and stale", () => {
    const missing = providers.find((p) => p.id === "local-no-packages")!;
    const stale = providers.find((p) => p.id === "evidence-stale")!;
    assert.equal(missing.sources?.[0]?.status, "404");
    assert.equal(stale.sources?.[0]?.freshness, "stale");
    assert.equal(scoreLegacyProvider(missing).components.conf.source_url, 15);
    assert.equal(scoreLegacyProvider(stale).components.conf.source_url, 15);
  });

  it("keeps production OSS SQL free of Virtualizor despite methodology copy drift", () => {
    assert.match(LEGACY_OSS_SQL, /proxmox\|openstack/);
    assert.doesNotMatch(LEGACY_OSS_SQL, /virtualizor/i);
  });
});
