import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fixturesDir, loadJson, loadProviderFixtures, sourcePath } from "./load-fixtures.ts";

type Manifest = {
  blessed_for_new_engine: boolean;
  immutable: boolean;
  required_coverage: Record<string, string>;
};

type Expected = {
  provider_id: string;
  blessed_for_new_engine: boolean;
  known_defects: Array<{ id: string; blessed: boolean }>;
};

const REQUIRED_CASES = [
  "local_provider_with_public_packages",
  "local_provider_without_packages",
  "global_provider_with_asean_region",
  "multi_region_provider",
  "exact_facility",
  "city_only_disclosure",
  "confirmed_kvm",
  "hedged_kvm",
  "negated_kvm",
  "current_price",
  "annual_commitment",
  "promo_price",
  "unsupported_currency",
  "source_200",
  "source_redirect",
  "source_403",
  "source_404",
  "source_malformed",
  "source_stale",
] as const;

describe("Phase 0 sanitized acceptance corpus", () => {
  const manifest = loadJson<Manifest>("MANIFEST.json");
  const providers = loadProviderFixtures();

  it("is documented as immutable comparison evidence, not a blessed new engine", () => {
    assert.equal(manifest.immutable, true);
    assert.equal(manifest.blessed_for_new_engine, false);
    const scores = loadJson<{ blessed_for_new_engine: boolean }>("legacy-scores.json");
    const shortlists = loadJson<{ blessed_for_new_engine: boolean }>("legacy-shortlists.json");
    assert.equal(scores.blessed_for_new_engine, false);
    assert.equal(shortlists.blessed_for_new_engine, false);
  });

  it("covers every required provider, source, technology, price, and geography case", () => {
    const tags = new Set(providers.flatMap((p) => p.coverage_tags ?? []));
    for (const key of REQUIRED_CASES) {
      assert.ok(manifest.required_coverage[key], `manifest missing ${key}`);
      const rel = manifest.required_coverage[key];
      assert.ok(existsSync(`${fixturesDir}/${rel}`), `missing fixture file for ${key}: ${rel}`);
      if (rel.startsWith("providers/")) {
        assert.ok(tags.has(key), `no provider tagged ${key}`);
      }
    }
  });

  it("keeps source HTML synthetic and free of live credentials", () => {
    const names = [
      "ok-200.html",
      "redirect-302.html",
      "forbidden-403.html",
      "missing-404.html",
      "malformed.html",
      "stale-evidence.html",
    ];
    for (const name of names) {
      const html = readFileSync(sourcePath(name), "utf8");
      assert.ok(html.length > 20, name);
      assert.doesNotMatch(html, /postgres:\/\//);
      assert.doesNotMatch(html, /BEGIN (RSA|OPENSSH) PRIVATE KEY/);
      assert.doesNotMatch(html, /cloudin\.asia/);
    }
  });

  it("records known defects without blessing them", () => {
    let count = 0;
    for (const p of providers) {
      const expected = loadJson<Expected>(`expected/${p.id}.json`);
      assert.equal(expected.provider_id, p.id);
      assert.equal(expected.blessed_for_new_engine, false);
      for (const defect of expected.known_defects) {
        assert.equal(defect.blessed, false, defect.id);
        count += 1;
      }
    }
    assert.ok(count >= 8, "corpus must record the known scoring defects");
  });
});
