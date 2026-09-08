export {
  ALGORITHM_VERSION,
  CURRENT_METHODOLOGY,
  DEFAULT_CRITICAL_DIMENSIONS,
  DEFAULT_EVIDENCE_READINESS,
  DEFAULT_RULESET,
  DEFAULT_WEIGHTS,
  METHODOLOGY_ASEAN_COUNTRIES,
  METHODOLOGY_ID,
  OPEN_TECHNOLOGY_SLUGS,
  SCORING_DIMENSIONS,
  defineMethodology,
  hashRuleset,
  unknownDoesNotScoreAsZero,
  type EvidenceReadinessPolicy,
  type MethodologyRuleset,
  type MethodologyVersion,
  type ScoringDimension,
} from "./methodology.ts";
export {
  compareScoreExplanations,
  scoreOfferingDeployment,
  type ScoreInput,
} from "./engine.ts";
export { scoreWithFallback, isLegacyFallback, LEGACY_FALLBACK_LABEL } from "./fallback.ts";
export { SURFACES, explainForSurface, toPublicScoreView } from "./surfaces.ts";
export {
  CANONICAL_METRIC_DESCRIPTORS,
  SORT_METRIC_DESCRIPTORS,
  allCanonicalDescriptors,
  descriptorForSort,
  sortMetricLabel,
  type MetricDescriptor,
  type SortMetricId,
} from "./descriptors.ts";
export type {
  CommercialValue,
  ConstraintEvaluation,
  ConstraintKind,
  ConstraintResult,
  EvidenceItem,
  FacilityValue,
  HardConstraints,
  KnowledgeBound,
  LegacyProviderScores,
  OfferingDeploymentSubject,
  PublicSurface,
  RecommendationGroup,
  ResidencyPlane,
  ScoreComponent,
  ScoreEngineKind,
  ScoreExplanation,
  TechnologyFact,
} from "./types.ts";
