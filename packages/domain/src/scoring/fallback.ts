import type { MethodologyVersion } from "./methodology.ts";
import type { HardConstraints, LegacyProviderScores, ScoreExplanation } from "./types.ts";
import { SCORING_DIMENSIONS } from "./types.ts";

export const LEGACY_FALLBACK_LABEL =
  "Legacy fallback: canonical offering/deployment data unavailable";

export function scoreWithFallback(args: {
  canonical: ScoreExplanation | null;
  legacyProvider?: LegacyProviderScores | null;
  methodology: MethodologyVersion;
  dataRevision: string;
  constraints?: HardConstraints;
}): ScoreExplanation {
  if (args.canonical) {
    return args.canonical;
  }
  const provider = args.legacyProvider;
  const hasHard =
    Boolean(args.constraints?.country) ||
    Boolean(args.constraints?.legalCountry) ||
    Boolean(args.constraints?.requireNamedFacility) ||
    Boolean(args.constraints?.residencyCountry);
  return {
    offeringId: provider?.id ?? "unknown",
    deploymentId: "legacy-unscoped",
    providerId: provider?.id ?? "unknown",
    algorithmVersion: args.methodology.algorithmVersion,
    methodologyId: args.methodology.id,
    rulesetHash: args.methodology.rulesetHash,
    dataRevision: args.dataRevision,
    engine: "legacy-fallback",
    components: SCORING_DIMENSIONS.map((dimension) => ({
      dimension,
      knowledgeState: "unknown" as const,
      rawValue: null,
      weightedValue: null,
      weight: args.methodology.ruleset.weights[dimension],
      reasonCodes: ["LEGACY_FALLBACK", "CANONICAL_DATA_UNAVAILABLE"],
      uncertainty: 1,
    })),
    composite: null,
    rankingLowerBound: null,
    uncertainty: 1,
    reasonCodes: ["LEGACY_FALLBACK", "CANONICAL_DATA_UNAVAILABLE"],
    recommendationGroup: hasHard ? "needs_verification" : "needs_verification",
    constraintResults: [],
    tieBreakKey: `${provider?.id ?? "unknown"}:legacy-unscoped:${provider?.id ?? "unknown"}`,
    fallbackLabel: LEGACY_FALLBACK_LABEL,
    legacy: provider ?? undefined,
  };
}

export function isLegacyFallback(explanation: ScoreExplanation): boolean {
  return explanation.engine === "legacy-fallback";
}
