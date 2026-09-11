import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { LegacyProviderRecord } from "../web/src/lib/legacy-scoring.ts";

export type ProviderFixture = LegacyProviderRecord & {
  coverage_tags?: string[];
  sources?: Array<{
    url?: string | null;
    status?: string | null;
    fixture?: string;
    observed_at?: string;
    freshness?: string;
    final_url?: string;
  }>;
};

function findFixturesDir(): string {
  const candidates = [
    join(process.cwd(), "tests", "fixtures"),
    join(process.cwd(), "..", "tests", "fixtures"),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  throw new Error("tests/fixtures not found from process.cwd()");
}

export const fixturesDir = findFixturesDir();

export function loadJson<T>(rel: string): T {
  return JSON.parse(readFileSync(join(fixturesDir, rel), "utf8")) as T;
}

export function loadProviderFixtures(): ProviderFixture[] {
  const dir = join(fixturesDir, "providers");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => loadJson<ProviderFixture>(`providers/${f}`));
}

export function sourcePath(name: string): string {
  return join(fixturesDir, "sources", name);
}
