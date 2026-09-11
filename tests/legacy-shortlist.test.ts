import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { orderLikeGetArena, rankArenaRows, toLegacyArenaRow } from "../web/src/lib/legacy-scoring.ts";
import { arenaHref, deriveNeeds, shortlistProviders, type NeedsState } from "../web/src/lib/needs.ts";
import { loadJson, loadProviderFixtures } from "./load-fixtures.ts";

type ShortSnap = {
  blessed_for_new_engine: boolean;
  arena: Record<string, string[]>;
  cases: Record<
    string,
    {
      blessed_for_new_engine: boolean;
      needs?: NeedsState;
      derived?: { sort: string; scope: string; country: string; highImpact: boolean; arena_href: string };
      shortlist_ids?: string[];
      selected_ids?: string[];
      known_defects?: Array<{ id: string; blessed: boolean }>;
    }
  >;
};

describe("legacy wizard and Arena shortlists (production functions)", () => {
  const snap = loadJson<ShortSnap>("legacy-shortlists.json");
  const rows = orderLikeGetArena(loadProviderFixtures().map(toLegacyArenaRow));

  it("does not bless wizard snapshots as future methodology", () => {
    assert.equal(snap.blessed_for_new_engine, false);
    for (const c of Object.values(snap.cases)) {
      assert.equal(c.blessed_for_new_engine, false);
    }
  });

  it("reproduces deriveNeeds and shortlistProviders for the acceptance cases", () => {
    for (const [id, c] of Object.entries(snap.cases)) {
      if (!c.needs || !c.derived || !c.shortlist_ids) continue;
      const derived = deriveNeeds(c.needs);
      const picks = shortlistProviders(rows, derived, 4);
      assert.deepEqual(
        {
          sort: derived.sort,
          scope: derived.scope,
          country: derived.country,
          highImpact: derived.highImpact,
          arena_href: arenaHref(derived),
          shortlist_ids: picks.map((p) => p.id),
        },
        {
          sort: c.derived.sort,
          scope: c.derived.scope,
          country: c.derived.country,
          highImpact: c.derived.highImpact,
          arena_href: c.derived.arena_href,
          shortlist_ids: c.shortlist_ids,
        },
        id
      );
    }
  });

  it("captures the one-country relaxation defect without accepting it as correct", () => {
    const c = snap.cases["wizard-brunei-relaxes"];
    assert.ok(c.known_defects?.some((d) => d.id === "one-country-shortlist-relaxation" && d.blessed === false));
    const derived = deriveNeeds(c.needs!);
    assert.equal(derived.country, "Brunei");
    const picks = shortlistProviders(rows, derived, 4);
    assert.ok(picks.some((p) => p.id !== "solo-brunei"), "legacy shortlist widened past Brunei");
    assert.deepEqual(
      picks.map((p) => p.id),
      ["local-packages", "multi-region", "solo-brunei", "kvm-negated"]
    );
    const arenaOnly = rankArenaRows(rows, "sov", "asean", "Brunei");
    assert.deepEqual(arenaOnly.map((r) => r.id), ["solo-brunei"]);
  });

  it("keeps a two-provider country filter tight (Indonesia public sector)", () => {
    const c = snap.cases["wizard-public-indonesia"];
    const derived = deriveNeeds(c.needs!);
    assert.equal(derived.country, "Indonesia");
    assert.equal(derived.sort, "sov");
    assert.equal(derived.highImpact, true);
    assert.deepEqual(
      shortlistProviders(rows, derived, 4).map((p) => p.id),
      ["local-packages", "local-no-packages"]
    );
  });

  it("shares Arena sort keys with the frozen ranking tables", () => {
    assert.deepEqual(rankArenaRows(rows, "sov", "asean", "all").map((r) => r.id), snap.arena.sov_asean);
    assert.deepEqual(rankArenaRows(rows, "cost", "all", "all").map((r) => r.id), snap.arena.cost_all);
  });
});
