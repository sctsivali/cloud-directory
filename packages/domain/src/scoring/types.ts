import type { AssessmentState, KnowledgeState } from "../knowledge-state.ts";
import type { MapPrecision } from "../geography.ts";
import type { TechnologyScope } from "../technology.ts";

export const SCORING_DIMENSIONS = [
  "primary_data_residency",
  "backup_residency",
  "metadata_control_plane_residency",
  "contracting_entity_legal_control",
  "administrative_access_key_control",
  "evidence_coverage",
  "evidence_quality",
  "open_technology_portability",
  "commercial_comparability",
] as const;

export type ScoringDimension = (typeof SCORING_DIMENSIONS)[number];

export type RecommendationGroup = "eligible" | "needs_verification" | "excluded";

export type ScoreEngineKind = "canonical" | "legacy-fallback";

export type KnowledgeBound<T> = {
  knowledgeState: KnowledgeState;
  value: T | null;
  evidenceCount?: number;
};

export type ContractingEntityValue = {
  id: string;
  jurisdictionCountry: string;
  legalName?: string;
};

export type FacilityValue = {
  id: string;
  name: string;
  country: string;
  named: boolean;
  mapPrecision: MapPrecision;
};

export type TechnologyFact = {
  slug: string;
  category: string;
  knowledgeState: KnowledgeState;
  scope: TechnologyScope;
  scopeId: string;
  hasUniversalScopeEvidence: boolean;
  appliesToSubject: boolean;
};

export type CommercialValue = {
  amount: number;
  currency: string;
  billingUnit: string;
  commitment: string | null;
  promo: boolean;
  comparable: boolean;
};

export type EvidenceItem = {
  claimType: string;
  assessmentState: AssessmentState;
  knowledgeState: KnowledgeState;
  independent: boolean;
  freshnessDays: number | null;
  excerptPresent: boolean;
};

export type OfferingDeploymentSubject = {
  offeringId: string;
  deploymentId: string;
  providerId: string;
  offeringName?: string;
  providerName?: string;
  serviceId?: string;
  deploymentCountry: KnowledgeBound<string>;
  primaryResidency: KnowledgeBound<string>;
  backupResidency: KnowledgeBound<string>;
  metadataResidency: KnowledgeBound<string>;
  contractingEntity: KnowledgeBound<ContractingEntityValue>;
  administrativeAccess: KnowledgeBound<{ localAdmin: boolean; country?: string }>;
  keyControl: KnowledgeBound<{ customerHeld: boolean; country?: string }>;
  facility: KnowledgeBound<FacilityValue>;
  technologies: TechnologyFact[];
  commercial: KnowledgeBound<CommercialValue>;
  evidenceItems: EvidenceItem[];
};

export type ScoreComponent = {
  dimension: ScoringDimension;
  knowledgeState: KnowledgeState;
  rawValue: number | null;
  weightedValue: number | null;
  weight: number;
  reasonCodes: string[];
  uncertainty: number;
};

export type ConstraintKind = "country" | "legal_entity" | "facility" | "residency";

export type ResidencyPlane = "primary" | "backup" | "metadata";

export type HardConstraints = {
  country?: string;
  legalCountry?: string;
  requireNamedFacility?: boolean;
  residencyCountry?: string;
  residencyPlane?: ResidencyPlane;
};

export type ConstraintEvaluation = {
  kind: ConstraintKind;
  outcome: "pass" | "fail" | "unknown" | "conflict";
  reasonCodes: string[];
  subjectGrain: "offering" | "deployment";
};

export type ConstraintResult = {
  group: RecommendationGroup;
  evaluations: ConstraintEvaluation[];
  reasonCodes: string[];
};

export type LegacyProviderScores = {
  id: string;
  name: string;
  sov: number;
  oss: number;
  conf: number;
};

export type ScoreExplanation = {
  offeringId: string;
  deploymentId: string;
  providerId: string;
  algorithmVersion: string;
  methodologyId: string;
  rulesetHash: string;
  dataRevision: string;
  engine: ScoreEngineKind;
  components: ScoreComponent[];
  composite: number | null;
  rankingLowerBound: number | null;
  uncertainty: number;
  reasonCodes: string[];
  recommendationGroup: RecommendationGroup;
  constraintResults: ConstraintEvaluation[];
  tieBreakKey: string;
  fallbackLabel?: string;
  legacy?: LegacyProviderScores;
};

export type PublicSurface =
  | "arena"
  | "wizard"
  | "compare"
  | "provider"
  | "methodology"
  | "mcp";
