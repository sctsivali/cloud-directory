import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  compareLegacyValues,
  legacyUsdMonth,
  orderLikeGetArena,
  rankArenaRows,
  scoreLegacyProvider,
  toLegacyArenaRow,
} from "../web/src/lib/legacy-scoring.ts";
import { arenaHref, deriveNeeds, shortlistProviders, type NeedsState } from "../web/src/lib/needs.ts";
import { fixturesDir, loadProviderFixtures } from "./load-fixtures.ts";

const providers = loadProviderFixtures();
const scores: Record<string, unknown> = {};
for (const p of providers) {
  const scored = scoreLegacyProvider(p);
  const row = toLegacyArenaRow(p);
  scores[p.id] = {
    id: p.id,
    name: p.name,
    blessed_for_new_engine: false,
    sov: scored.sov,
    conf: scored.conf,
    oss: scored.oss,
    components: scored.components,
    min_price: row.min_price,
    loc_count: row.loc_count,
    max_vcpu: row.max_vcpu,
    max_ram: row.max_ram,
    is_local_asean: p.is_local_asean,
    hq_country: p.hq_country,
  };
}

const rows = orderLikeGetArena(providers.map(toLegacyArenaRow));
const arena = {
  fetch_order: rows.map((r) => r.id),
  sov_asean: rankArenaRows(rows, "sov", "asean", "all").map((r) => r.id),
  oss_asean: rankArenaRows(rows, "oss", "asean", "all").map((r) => r.id),
  conf_asean: rankArenaRows(rows, "conf", "asean", "all").map((r) => r.id),
  cost_all: rankArenaRows(rows, "cost", "all", "all").map((r) => r.id),
  cover_asean: rankArenaRows(rows, "cover", "asean", "all").map((r) => r.id),
  perf_asean: rankArenaRows(rows, "perf", "asean", "all").map((r) => r.id),
  brunei_hard: rankArenaRows(rows, "sov", "asean", "Brunei").map((r) => r.id),
};

const needs: Record<string, NeedsState> = {
  "wizard-public-indonesia": {
    sector: "public",
    workloads: ["publicsvc"],
    impact: "critical",
    data: "sensitive",
    countries: ["Indonesia"],
    priorities: ["location", "docs"],
    extras: { residency: "must_in_country", hall: "need_hall", entity: "local_entity", docs: "need_docs" },
  },
  "wizard-learn-price": {
    sector: "learn",
    workloads: ["unsure"],
    impact: "unknown",
    data: "unknown",
    countries: [],
    priorities: [],
    extras: { learn_focus: "price" },
  },
  "wizard-portability": {
    sector: "biz",
    workloads: ["web"],
    impact: "low",
    data: "public",
    countries: ["Singapore", "Malaysia"],
    priorities: ["portability"],
    extras: { market: "global" },
  },
  "wizard-brunei-relaxes": {
    sector: "biz",
    workloads: ["internal"],
    impact: "ops",
    data: "personal",
    countries: ["Brunei"],
    priorities: ["location"],
    extras: { market: "domestic" },
  },
  "wizard-docs-conf": {
    sector: "biz",
    workloads: ["web"],
    impact: "low",
    data: "public",
    countries: ["Singapore", "Malaysia"],
    priorities: ["docs"],
    extras: { market: "global" },
  },
};

const cases: Record<string, unknown> = {};
for (const [id, state] of Object.entries(needs)) {
  const derived = deriveNeeds(state);
  const picks = shortlistProviders(rows, derived, 4);
  cases[id] = {
    id,
    blessed_for_new_engine: false,
    needs: state,
    derived: {
      sort: derived.sort,
      scope: derived.scope,
      country: derived.country,
      highImpact: derived.highImpact,
      arena_href: arenaHref(derived),
    },
    shortlist_ids: picks.map((p) => p.id),
  };
}

cases["compare-top-sov"] = {
  id: "compare-top-sov",
  blessed_for_new_engine: false,
  selected_ids: ["local-packages", "multi-region"],
  values: compareLegacyValues(rows, ["local-packages", "multi-region"]),
};

const scoreDoc = {
  methodology: "legacy-sql-v1",
  blessed_for_new_engine: false,
  generated_from: "web/src/lib/legacy-scoring.ts + web/src/lib/needs.ts",
  scores,
  arena,
  pricing_probes: {
    unsupported_lak_80000: legacyUsdMonth(80000, "LAK"),
    php_56000: legacyUsdMonth(56000, "PHP"),
    usd_8_5: legacyUsdMonth(8.5, "USD"),
  },
};

const shortlistDoc = {
  methodology: "legacy-wizard-v1",
  blessed_for_new_engine: false,
  generated_from: "web/src/lib/needs.ts + rankArenaRows",
  arena,
  cases,
};

if (process.argv.includes("--write")) {
  writeFileSync(join(fixturesDir, "legacy-scores.json"), `${JSON.stringify(scoreDoc, null, 2)}\n`);
  writeFileSync(join(fixturesDir, "legacy-shortlists.json"), `${JSON.stringify(shortlistDoc, null, 2)}\n`);
}

console.log(JSON.stringify({ scores, arena, cases, pricing: scoreDoc.pricing_probes }, null, 2));
