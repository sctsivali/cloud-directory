import { compareScoreExplanations, scoreOfferingDeployment } from "../scoring/engine.ts";
import type { MethodologyVersion } from "../scoring/methodology.ts";
import type {
  HardConstraints,
  OfferingDeploymentSubject,
  ScoreExplanation,
} from "../scoring/types.ts";

export type RecommendationBuckets = {
  eligible: ScoreExplanation[];
  needs_verification: ScoreExplanation[];
  excluded: ScoreExplanation[];
};

export function recommendSubjects(args: {
  subjects: OfferingDeploymentSubject[];
  constraints: HardConstraints;
  methodology: MethodologyVersion;
  dataRevision: string;
}): RecommendationBuckets {
  const scored = args.subjects.map((subject) =>
    scoreOfferingDeployment({
      subject,
      methodology: args.methodology,
      dataRevision: args.dataRevision,
      constraints: args.constraints,
    })
  );
  scored.sort(compareScoreExplanations);
  return {
    eligible: scored.filter((s) => s.recommendationGroup === "eligible"),
    needs_verification: scored.filter((s) => s.recommendationGroup === "needs_verification"),
    excluded: scored.filter((s) => s.recommendationGroup === "excluded"),
  };
}

export function flattenRecommendations(buckets: RecommendationBuckets): ScoreExplanation[] {
  return [...buckets.eligible, ...buckets.needs_verification, ...buckets.excluded];
}
