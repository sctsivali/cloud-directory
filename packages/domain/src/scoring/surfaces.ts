import { scoreOfferingDeployment, type ScoreInput } from "./engine.ts";
import type { PublicSurface, ScoreExplanation } from "./types.ts";

export const SURFACES: readonly PublicSurface[] = [
  "arena",
  "wizard",
  "compare",
  "provider",
  "methodology",
  "mcp",
] as const;

/** One engine for every public surface. The surface name is not part of the score. */
export function explainForSurface(_surface: PublicSurface, input: ScoreInput): ScoreExplanation {
  return scoreOfferingDeployment(input);
}

export function toPublicScoreView(explanation: ScoreExplanation) {
  return {
    offeringId: explanation.offeringId,
    deploymentId: explanation.deploymentId,
    providerId: explanation.providerId,
    engine: explanation.engine,
    algorithmVersion: explanation.algorithmVersion,
    methodologyId: explanation.methodologyId,
    rulesetHash: explanation.rulesetHash,
    dataRevision: explanation.dataRevision,
    composite: explanation.composite,
    rankingLowerBound: explanation.rankingLowerBound,
    uncertainty: explanation.uncertainty,
    reasonCodes: explanation.reasonCodes,
    recommendationGroup: explanation.recommendationGroup,
    components: explanation.components,
    constraintResults: explanation.constraintResults,
    fallbackLabel: explanation.fallbackLabel ?? null,
    legacy: explanation.legacy ?? null,
  };
}
