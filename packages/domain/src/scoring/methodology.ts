import { canonicalJson, sha256Hex } from "./hash.ts";
import { SCORING_DIMENSIONS, type ScoreComponent, type ScoringDimension } from "./types.ts";

export { SCORING_DIMENSIONS, type ScoringDimension };

export const ALGORITHM_VERSION = "1.0.0";
export const METHODOLOGY_ID = "asean-offering-deployment-v1";

export const METHODOLOGY_ASEAN_COUNTRIES = [
  "Indonesia",
  "Malaysia",
  "Singapore",
  "Thailand",
  "Vietnam",
  "Philippines",
  "Cambodia",
  "Laos",
  "Myanmar",
  "Brunei",
] as const;

export const OPEN_TECHNOLOGY_SLUGS = [
  "kvm",
  "proxmox",
  "xen",
  "kubernetes",
  "k8s",
  "ceph",
  "openebs",
  "longhorn",
  "rook",
  "openstack",
] as const;

export type EvidenceReadinessPolicy = {
  minCoverage: number;
  criticalDimensions: readonly ScoringDimension[];
  materialConflictClaimTypes: readonly string[];
  materialConflictShare: number;
};

export type MethodologyRuleset = {
  weights: Record<ScoringDimension, number>;
  aseanCountries: readonly string[];
  openTechnologySlugs: readonly string[];
  requiredEvidenceClaimTypes: readonly string[];
  evidenceReadiness: EvidenceReadinessPolicy;
};

export type MethodologyVersion = {
  id: string;
  algorithmVersion: string;
  ruleset: MethodologyRuleset;
  rulesetHash: string;
  publishedAt: string | null;
  notes: string;
};

export const DEFAULT_WEIGHTS: Record<ScoringDimension, number> = {
  primary_data_residency: 15,
  backup_residency: 10,
  metadata_control_plane_residency: 10,
  contracting_entity_legal_control: 15,
  administrative_access_key_control: 10,
  evidence_coverage: 10,
  evidence_quality: 10,
  open_technology_portability: 10,
  commercial_comparability: 10,
};

export const REQUIRED_EVIDENCE_CLAIM_TYPES = [
  "primary_residency",
  "backup_residency",
  "metadata_residency",
  "legal_entity",
  "facility",
  "technology",
  "price",
] as const;

export const DEFAULT_CRITICAL_DIMENSIONS = [
  "primary_data_residency",
  "backup_residency",
  "metadata_control_plane_residency",
  "contracting_entity_legal_control",
  "administrative_access_key_control",
  "evidence_coverage",
  "evidence_quality",
] as const satisfies readonly ScoringDimension[];

export const DEFAULT_EVIDENCE_READINESS: EvidenceReadinessPolicy = {
  minCoverage: 0.5,
  criticalDimensions: DEFAULT_CRITICAL_DIMENSIONS,
  materialConflictClaimTypes: REQUIRED_EVIDENCE_CLAIM_TYPES,
  materialConflictShare: 0.5,
};

export const DEFAULT_RULESET: MethodologyRuleset = {
  weights: DEFAULT_WEIGHTS,
  aseanCountries: METHODOLOGY_ASEAN_COUNTRIES,
  openTechnologySlugs: OPEN_TECHNOLOGY_SLUGS,
  requiredEvidenceClaimTypes: REQUIRED_EVIDENCE_CLAIM_TYPES,
  evidenceReadiness: DEFAULT_EVIDENCE_READINESS,
};

export function hashRuleset(ruleset: MethodologyRuleset): string {
  return sha256Hex(canonicalJson(ruleset));
}

export function defineMethodology(input: {
  id: string;
  algorithmVersion: string;
  ruleset: MethodologyRuleset;
  publishedAt?: string | null;
  notes?: string;
}): MethodologyVersion {
  return {
    id: input.id,
    algorithmVersion: input.algorithmVersion,
    ruleset: input.ruleset,
    rulesetHash: hashRuleset(input.ruleset),
    publishedAt: input.publishedAt ?? null,
    notes: input.notes ?? "",
  };
}

export const CURRENT_METHODOLOGY: MethodologyVersion = defineMethodology({
  id: METHODOLOGY_ID,
  algorithmVersion: ALGORITHM_VERSION,
  ruleset: DEFAULT_RULESET,
  publishedAt: "2026-09-09T00:00:00Z",
  notes:
    "Offering/deployment grain. Unknown is not zero. Hard constraints never relax. Evidence-readiness gates eligibility; ranking uses the uncertainty-adjusted lower bound.",
});

/** Unknown and conflicting components must not be treated as a numeric zero. */
export function unknownDoesNotScoreAsZero(component: ScoreComponent): boolean {
  if (component.knowledgeState === "unknown" || component.knowledgeState === "conflicting") {
    return component.rawValue === null && component.weightedValue === null;
  }
  if (component.knowledgeState === "not_applicable") {
    return component.rawValue === null;
  }
  return true;
}
