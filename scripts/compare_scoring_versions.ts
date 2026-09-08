#!/usr/bin/env node
/**
 * Shadow-compare legacy provider scores with the Phase 5 offering/deployment engine.
 * Fixture-only. Does not replace public ranking.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CURRENT_METHODOLOGY,
  compareScoreExplanations,
  scoreOfferingDeployment,
  scoreWithFallback,
  type OfferingDeploymentSubject,
  type ScoreExplanation,
} from "../packages/domain/src/scoring/index.ts";
import { scoreLegacyProvider, type LegacyProviderRecord } from "../web/src/lib/legacy-scoring.ts";
import { loadProviderFixtures } from "../tests/load-fixtures.ts";

function namedCity(city?: string | null): boolean {
  const trimmed = (city ?? "").trim();
  return trimmed !== "" && !/^(undisclosed|unknown|not disclosed)/i.test(trimmed);
}

function projectLegacyProviderToSubjects(provider: LegacyProviderRecord): OfferingDeploymentSubject[] {
  const tiers = (provider.tiers ?? []).filter((t) => t.status === "OK");
  const listed = (provider.buildings ?? []).find((b) => b.listed);
  return tiers.map((tier) => {
    const country = namedCity(tier.dc_city) && tier.dc_country ? tier.dc_country : null;
    const countryState = country ? "present" : "unknown";
    return {
      offeringId: tier.id,
      deploymentId: `${tier.id}:dc`,
      providerId: provider.id,
      offeringName: tier.id,
      providerName: provider.name,
      deploymentCountry: { knowledgeState: countryState, value: country },
      primaryResidency: { knowledgeState: countryState, value: country },
      backupResidency: { knowledgeState: "unknown", value: null },
      metadataResidency: { knowledgeState: "unknown", value: null },
      contractingEntity: { knowledgeState: "unknown", value: null },
      administrativeAccess: { knowledgeState: "unknown", value: null },
      keyControl: { knowledgeState: "unknown", value: null },
      facility: listed
        ? {
            knowledgeState: "present",
            value: {
              id: listed.name,
              name: listed.name,
              country: listed.country,
              named: true,
              mapPrecision: "campus",
            },
          }
        : { knowledgeState: "unknown", value: null },
      technologies: [],
      commercial:
        tier.price_usd_month != null
          ? {
              knowledgeState: "present",
              value: {
                amount: tier.price_usd_month,
                currency: tier.currency ?? "USD",
                billingUnit: "month",
                commitment: null,
                promo: Boolean(tier.promo),
                comparable: true,
              },
            }
          : { knowledgeState: "unknown", value: null },
      evidenceItems: [],
    } as OfferingDeploymentSubject;
  });
}

export type ShadowRow = {
  providerId: string;
  providerName: string;
  legacySov: number;
  legacyOss: number;
  legacyConf: number;
  engine: ScoreExplanation["engine"];
  composite: number | null;
  rankingLowerBound: number | null;
  uncertainty: number;
  group: ScoreExplanation["recommendationGroup"];
  reasonCodes: string[];
  rankingChange: string;
};

export function compareScoringVersions(providers: LegacyProviderRecord[]): ShadowRow[] {
  return providers.map((provider) => {
    const legacy = scoreLegacyProvider(provider);
    const subjects = projectLegacyProviderToSubjects(provider);
    const scored =
      subjects.length > 0
        ? subjects
            .map((subject) =>
              scoreOfferingDeployment({
                subject,
                methodology: CURRENT_METHODOLOGY,
                dataRevision: "shadow-fixtures",
              })
            )
            .sort(compareScoreExplanations)[0]!
        : scoreWithFallback({
            canonical: null,
            legacyProvider: {
              id: provider.id,
              name: provider.name,
              sov: legacy.sov,
              oss: legacy.oss,
              conf: legacy.conf,
            },
            methodology: CURRENT_METHODOLOGY,
            dataRevision: "shadow-fixtures",
          });
    return {
      providerId: provider.id,
      providerName: provider.name,
      legacySov: legacy.sov,
      legacyOss: legacy.oss,
      legacyConf: legacy.conf,
      engine: scored.engine,
      composite: scored.composite,
      rankingLowerBound: scored.rankingLowerBound,
      uncertainty: scored.uncertainty,
      group: scored.recommendationGroup,
      reasonCodes: scored.reasonCodes,
      rankingChange:
        scored.engine === "legacy-fallback"
          ? "no_canonical_subject"
          : "composite_differs_from_legacy_sov",
    };
  });
}

export function renderShadowMarkdown(rows: ShadowRow[]): string {
  const lines = [
    "# Scoring shadow comparison",
    "",
    "Do not replace public ranking from this report. Editorial review is required.",
    "",
    `| Methodology | ${CURRENT_METHODOLOGY.id} ${CURRENT_METHODOLOGY.algorithmVersion} |`,
    `| Ruleset | ${CURRENT_METHODOLOGY.rulesetHash} |`,
    "",
    "| Provider | Legacy SOV | New composite | Lower bound | Engine | Group | Change | Reasons |",
    "|---|---:|---:|---|---|---|---|",
  ];
  for (const row of rows) {
    lines.push(
      `| ${row.providerName} | ${row.legacySov} | ${row.composite ?? "—"} | ${row.rankingLowerBound ?? "—"} | ${row.engine} | ${row.group} | ${row.rankingChange} | ${row.reasonCodes.slice(0, 4).join(", ")} |`
    );
  }
  lines.push("");
  return lines.join("\n");
}

function main() {
  const providers = loadProviderFixtures();
  const rows = compareScoringVersions(providers);
  const markdown = renderShadowMarkdown(rows);
  const outArg = process.argv.find((a) => a.startsWith("--out="));
  if (outArg) {
    writeFileSync(outArg.slice("--out=".length), markdown);
  } else {
    process.stdout.write(markdown);
  }
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect || process.argv[1]?.endsWith("compare_scoring_versions.ts")) {
  main();
}

