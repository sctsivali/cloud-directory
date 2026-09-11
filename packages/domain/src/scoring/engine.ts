import { evaluateConstraints } from "../recommendation/constraints.ts";
import type { AssessmentState, KnowledgeState } from "../knowledge-state.ts";
import type { EvidenceReadinessPolicy, MethodologyVersion } from "./methodology.ts";
import type {
  HardConstraints,
  OfferingDeploymentSubject,
  RecommendationGroup,
  ScoreComponent,
  ScoreExplanation,
  ScoringDimension,
} from "./types.ts";
import { SCORING_DIMENSIONS } from "./types.ts";

export type ScoreInput = {
  subject: OfferingDeploymentSubject;
  methodology: MethodologyVersion;
  dataRevision: string;
  constraints?: HardConstraints;
};

function qualityScore(assessment: AssessmentState): number {
  switch (assessment) {
    case "independently_verified":
      return 1;
    case "editorially_reviewed":
      return 0.85;
    case "provider_asserted":
      return 0.55;
    case "extracted":
      return 0.4;
    case "inferred":
      return 0.2;
    case "legacy/unverified":
      return 0.15;
    case "rejected":
      return 0;
    default:
      return 0;
  }
}

function residencyValue(
  state: KnowledgeState,
  country: string | null,
  asean: readonly string[]
): { raw: number | null; uncertainty: number; reasons: string[] } {
  if (state === "unknown") {
    return { raw: null, uncertainty: 1, reasons: ["UNKNOWN"] };
  }
  if (state === "conflicting") {
    return { raw: null, uncertainty: 1, reasons: ["CONFLICTING"] };
  }
  if (state === "not_applicable") {
    return { raw: null, uncertainty: 0, reasons: ["NOT_APPLICABLE"] };
  }
  if (state === "confirmed_absent") {
    return { raw: 0, uncertainty: 0.05, reasons: ["CONFIRMED_ABSENT"] };
  }
  if (!country) {
    return { raw: null, uncertainty: 1, reasons: ["UNKNOWN"] };
  }
  if (asean.includes(country)) {
    return { raw: 1, uncertainty: 0.05, reasons: ["RESIDENCY_PRESENT_ASEAN"] };
  }
  return { raw: 0.4, uncertainty: 0.1, reasons: ["RESIDENCY_PRESENT_OTHER"] };
}

function component(
  dimension: ScoringDimension,
  weight: number,
  knowledgeState: KnowledgeState,
  raw: number | null,
  uncertainty: number,
  reasonCodes: string[]
): ScoreComponent {
  return {
    dimension,
    knowledgeState,
    rawValue: raw,
    weightedValue: raw == null ? null : raw * weight,
    weight,
    reasonCodes,
    uncertainty,
  };
}

function scoreOpenTech(
  subject: OfferingDeploymentSubject,
  weight: number,
  openTechnologySlugs: readonly string[]
): ScoreComponent {
  const openSlugs = new Set(openTechnologySlugs.map((s) => s.toLowerCase()));
  const applying = subject.technologies.filter((t) => t.appliesToSubject);
  const blocked = subject.technologies.filter(
    (t) => !t.appliesToSubject && (t.scope === "provider" || t.scope === "service")
  );
  if (applying.length === 0) {
    const reasons = ["UNKNOWN"];
    if (blocked.length) reasons.push("TECH_NOT_INHERITED");
    return component("open_technology_portability", weight, "unknown", null, 1, reasons);
  }
  if (applying.some((t) => t.knowledgeState === "conflicting")) {
    return component("open_technology_portability", weight, "conflicting", null, 1, ["CONFLICTING"]);
  }
  if (applying.every((t) => t.knowledgeState === "confirmed_absent")) {
    return component("open_technology_portability", weight, "confirmed_absent", 0, 0.05, [
      "CONFIRMED_ABSENT",
    ]);
  }
  const present = applying.filter((t) => t.knowledgeState === "present");
  if (present.length === 0) {
    return component("open_technology_portability", weight, "unknown", null, 1, ["UNKNOWN"]);
  }
  const openHits = present.filter((t) => openSlugs.has(t.slug.toLowerCase()));
  const raw = Math.min(1, openHits.length / 3);
  return component("open_technology_portability", weight, "present", raw, 0.1, [
    openHits.length ? "OPEN_TECH_PRESENT" : "OPEN_TECH_NONE_MATCHED",
  ]);
}

function scoreEvidenceCoverage(
  subject: OfferingDeploymentSubject,
  weight: number,
  required: readonly string[]
): ScoreComponent {
  if (required.length === 0) {
    return component("evidence_coverage", weight, "not_applicable", null, 0, ["NOT_APPLICABLE"]);
  }
  if (subject.evidenceItems.length === 0) {
    return component("evidence_coverage", weight, "unknown", null, 1, ["UNKNOWN", "NO_EVIDENCE"]);
  }
  const knownTypes = new Set(
    subject.evidenceItems
      .filter((e) => e.knowledgeState === "present" || e.knowledgeState === "confirmed_absent")
      .map((e) => e.claimType)
  );
  const covered = required.filter((claimType) => knownTypes.has(claimType)).length;
  const raw = covered / required.length;
  const reasons = ["EVIDENCE_COVERAGE"];
  if (covered === 0 && knownTypes.size > 0) reasons.push("EVIDENCE_COVERAGE_IRRELEVANT");
  return component("evidence_coverage", weight, "present", raw, 1 - raw, reasons);
}

function scoreEvidenceQuality(
  subject: OfferingDeploymentSubject,
  weight: number,
  readiness: EvidenceReadinessPolicy
): ScoreComponent {
  const usable = subject.evidenceItems.filter(
    (e) => e.knowledgeState !== "unknown" && e.knowledgeState !== "not_applicable"
  );
  if (usable.length === 0) {
    return component("evidence_quality", weight, "unknown", null, 1, ["UNKNOWN", "NO_EVIDENCE"]);
  }
  const conflicting = usable.filter((e) => e.knowledgeState === "conflicting");
  const nonConflicting = usable.filter((e) => e.knowledgeState !== "conflicting");
  const materialTypes = new Set(readiness.materialConflictClaimTypes);
  const materialByType = conflicting.some((e) => materialTypes.has(e.claimType));
  const materialByShare = conflicting.length / usable.length >= readiness.materialConflictShare;
  const materialConflict = materialByType || materialByShare;
  if (usable.every((e) => e.knowledgeState === "conflicting") || materialConflict) {
    return component("evidence_quality", weight, "conflicting", null, 1, [
      "CONFLICTING",
      "EVIDENCE_CONFLICT",
    ]);
  }
  if (nonConflicting.length === 0) {
    return component("evidence_quality", weight, "conflicting", null, 1, [
      "CONFLICTING",
      "EVIDENCE_CONFLICT",
    ]);
  }
  const avg =
    nonConflicting.reduce((sum, item) => sum + qualityScore(item.assessmentState), 0) /
    nonConflicting.length;
  const reasons = ["EVIDENCE_QUALITY"];
  if (conflicting.length) reasons.push("EVIDENCE_CONFLICT_EXCLUDED");
  return component("evidence_quality", weight, "present", avg, 0.15, reasons);
}

function scoreCommercial(subject: OfferingDeploymentSubject, weight: number): ScoreComponent {
  const fact = subject.commercial;
  if (fact.knowledgeState === "unknown") {
    return component("commercial_comparability", weight, "unknown", null, 1, ["UNKNOWN"]);
  }
  if (fact.knowledgeState === "conflicting") {
    return component("commercial_comparability", weight, "conflicting", null, 1, ["CONFLICTING"]);
  }
  if (fact.knowledgeState === "confirmed_absent") {
    return component("commercial_comparability", weight, "confirmed_absent", 0, 0.05, [
      "CONFIRMED_ABSENT",
    ]);
  }
  const value = fact.value;
  if (!value || value.amount == null || !value.currency || !value.billingUnit) {
    return component("commercial_comparability", weight, "unknown", null, 1, ["UNKNOWN"]);
  }
  if (!value.comparable) {
    return component("commercial_comparability", weight, "present", 0, 0.2, ["NOT_COMPARABLE"]);
  }
  const raw = value.promo ? 0.4 : 1;
  return component("commercial_comparability", weight, "present", raw, 0.1, [
    value.promo ? "PROMO_PRICE" : "COMPARABLE_PRICE",
  ]);
}

function scoreAdminKeys(subject: OfferingDeploymentSubject, weight: number): ScoreComponent {
  const admin = subject.administrativeAccess;
  const keys = subject.keyControl;
  if (admin.knowledgeState === "conflicting" || keys.knowledgeState === "conflicting") {
    return component("administrative_access_key_control", weight, "conflicting", null, 1, [
      "CONFLICTING",
    ]);
  }
  if (admin.knowledgeState === "unknown" && keys.knowledgeState === "unknown") {
    return component("administrative_access_key_control", weight, "unknown", null, 1, ["UNKNOWN"]);
  }
  if (admin.knowledgeState === "confirmed_absent" && keys.knowledgeState === "confirmed_absent") {
    return component("administrative_access_key_control", weight, "confirmed_absent", 0, 0.05, [
      "CONFIRMED_ABSENT",
    ]);
  }
  const parts: number[] = [];
  if (admin.knowledgeState === "present" && admin.value) {
    parts.push(admin.value.localAdmin ? 1 : 0);
  }
  if (keys.knowledgeState === "present" && keys.value) {
    parts.push(keys.value.customerHeld ? 1 : 0);
  }
  if (parts.length === 0) {
    return component("administrative_access_key_control", weight, "unknown", null, 1, ["UNKNOWN"]);
  }
  const raw = parts.reduce((a, b) => a + b, 0) / parts.length;
  const state: KnowledgeState =
    admin.knowledgeState === "unknown" || keys.knowledgeState === "unknown" ? "present" : "present";
  return component("administrative_access_key_control", weight, state, raw, parts.length < 2 ? 0.4 : 0.1, [
    "ADMIN_KEY_SCORED",
  ]);
}

function scoreLegal(subject: OfferingDeploymentSubject, weight: number, asean: readonly string[]): ScoreComponent {
  const fact = subject.contractingEntity;
  if (fact.knowledgeState === "unknown") {
    return component("contracting_entity_legal_control", weight, "unknown", null, 1, ["UNKNOWN"]);
  }
  if (fact.knowledgeState === "conflicting") {
    return component("contracting_entity_legal_control", weight, "conflicting", null, 1, ["CONFLICTING"]);
  }
  if (fact.knowledgeState === "confirmed_absent") {
    return component("contracting_entity_legal_control", weight, "confirmed_absent", 0, 0.05, [
      "CONFIRMED_ABSENT",
    ]);
  }
  const country = fact.value?.jurisdictionCountry ?? null;
  if (!country) {
    return component("contracting_entity_legal_control", weight, "unknown", null, 1, ["UNKNOWN"]);
  }
  const raw = asean.includes(country) ? 1 : 0.3;
  return component("contracting_entity_legal_control", weight, "present", raw, 0.1, [
    "LEGAL_ENTITY_PRESENT",
  ]);
}

export function scoreOfferingDeployment(input: ScoreInput): ScoreExplanation {
  const { subject, methodology, dataRevision } = input;
  const weights = methodology.ruleset.weights;
  const asean = methodology.ruleset.aseanCountries;
  const components: ScoreComponent[] = [];

  const primary = residencyValue(
    subject.primaryResidency.knowledgeState,
    subject.primaryResidency.value,
    asean
  );
  components.push(
    component(
      "primary_data_residency",
      weights.primary_data_residency,
      subject.primaryResidency.knowledgeState,
      primary.raw,
      primary.uncertainty,
      primary.reasons
    )
  );
  const backup = residencyValue(
    subject.backupResidency.knowledgeState,
    subject.backupResidency.value,
    asean
  );
  components.push(
    component(
      "backup_residency",
      weights.backup_residency,
      subject.backupResidency.knowledgeState,
      backup.raw,
      backup.uncertainty,
      backup.reasons
    )
  );
  const meta = residencyValue(
    subject.metadataResidency.knowledgeState,
    subject.metadataResidency.value,
    asean
  );
  components.push(
    component(
      "metadata_control_plane_residency",
      weights.metadata_control_plane_residency,
      subject.metadataResidency.knowledgeState,
      meta.raw,
      meta.uncertainty,
      meta.reasons
    )
  );
  components.push(scoreLegal(subject, weights.contracting_entity_legal_control, asean));
  components.push(scoreAdminKeys(subject, weights.administrative_access_key_control));
  components.push(
    scoreEvidenceCoverage(subject, weights.evidence_coverage, methodology.ruleset.requiredEvidenceClaimTypes)
  );
  components.push(
    scoreEvidenceQuality(subject, weights.evidence_quality, methodology.ruleset.evidenceReadiness)
  );
  components.push(
    scoreOpenTech(
      subject,
      weights.open_technology_portability,
      methodology.ruleset.openTechnologySlugs
    )
  );
  components.push(scoreCommercial(subject, weights.commercial_comparability));

  const applicable = components.filter((c) => c.knowledgeState !== "not_applicable");
  const known = applicable.filter((c) => c.rawValue != null);
  const knownWeight = known.reduce((sum, c) => sum + c.weight, 0);
  const applicableWeight = applicable.reduce((sum, c) => sum + c.weight, 0);
  const composite =
    knownWeight > 0
      ? Math.round((known.reduce((sum, c) => sum + (c.weightedValue ?? 0), 0) / knownWeight) * 10000) /
        100
      : null;

  const knownWeightedSum = known.reduce((sum, c) => sum + (c.weightedValue ?? 0), 0);
  const rankingLowerBound =
    known.length > 0 && applicableWeight > 0
      ? Math.round((knownWeightedSum / applicableWeight) * 10000) / 100
      : null;

  const unknownWeight = applicable
    .filter((c) => c.knowledgeState === "unknown" || c.knowledgeState === "conflicting")
    .reduce((sum, c) => sum + c.weight, 0);
  const conflictCount = applicable.filter((c) => c.knowledgeState === "conflicting").length;
  let uncertainty = applicableWeight > 0 ? unknownWeight / applicableWeight : 1;
  if (conflictCount > 0) {
    uncertainty = Math.max(uncertainty, 0.5 + (0.25 * conflictCount) / SCORING_DIMENSIONS.length);
  }
  uncertainty = Math.round(Math.min(1, uncertainty) * 10000) / 10000;

  const reasonCodes = [...new Set(components.flatMap((c) => c.reasonCodes))];
  if (components.some((c) => c.knowledgeState === "unknown")) {
    reasonCodes.push("UNKNOWN_NOT_ZERO");
  }

  const constraint = evaluateConstraints(subject, input.constraints ?? {});
  const recommendationGroup = applyEvidenceReadiness(
    components,
    constraint.group,
    methodology.ruleset.evidenceReadiness,
    reasonCodes
  );

  return {
    offeringId: subject.offeringId,
    deploymentId: subject.deploymentId,
    providerId: subject.providerId,
    algorithmVersion: methodology.algorithmVersion,
    methodologyId: methodology.id,
    rulesetHash: methodology.rulesetHash,
    dataRevision,
    engine: "canonical",
    components,
    composite,
    rankingLowerBound,
    uncertainty,
    reasonCodes: [...new Set(reasonCodes)],
    recommendationGroup,
    constraintResults: constraint.evaluations,
    tieBreakKey: `${subject.offeringId}:${subject.deploymentId}:${subject.providerId}`,
  };
}

function applyEvidenceReadiness(
  components: ScoreComponent[],
  constraintGroup: RecommendationGroup,
  policy: EvidenceReadinessPolicy,
  reasonCodes: string[]
): RecommendationGroup {
  if (constraintGroup === "excluded") return "excluded";

  let notReady = false;
  for (const dimension of policy.criticalDimensions) {
    const scored = components.find((c) => c.dimension === dimension);
    if (!scored) continue;
    if (scored.knowledgeState === "unknown") {
      reasonCodes.push("CRITICAL_DIMENSION_UNKNOWN");
      notReady = true;
    } else if (scored.knowledgeState === "conflicting") {
      reasonCodes.push("CRITICAL_DIMENSION_CONFLICTING");
      notReady = true;
    }
  }
  const coverage = components.find((c) => c.dimension === "evidence_coverage");
  const coverageRaw = coverage?.rawValue ?? null;
  const belowThreshold =
    policy.minCoverage > 0 && (coverageRaw == null || coverageRaw < policy.minCoverage);
  if (belowThreshold) {
    reasonCodes.push("COVERAGE_BELOW_THRESHOLD");
    notReady = true;
  }
  if (notReady) {
    reasonCodes.push("EVIDENCE_NOT_READY");
    return "needs_verification";
  }
  return constraintGroup;
}

function nullLastDesc(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return b - a;
}

const GROUP_RANK: Record<RecommendationGroup, number> = {
  eligible: 0,
  needs_verification: 1,
  excluded: 2,
};

export function compareScoreExplanations(a: ScoreExplanation, b: ScoreExplanation): number {
  const group = GROUP_RANK[a.recommendationGroup] - GROUP_RANK[b.recommendationGroup];
  if (group !== 0) return group;
  const ranking = nullLastDesc(a.rankingLowerBound, b.rankingLowerBound);
  if (ranking !== 0) return ranking;
  const composite = nullLastDesc(a.composite, b.composite);
  if (composite !== 0) return composite;
  if (a.uncertainty !== b.uncertainty) return a.uncertainty - b.uncertainty;
  const coverA = a.components.find((c) => c.dimension === "evidence_coverage")?.rawValue ?? null;
  const coverB = b.components.find((c) => c.dimension === "evidence_coverage")?.rawValue ?? null;
  const cover = nullLastDesc(coverA, coverB);
  if (cover !== 0) return cover;
  return (
    a.offeringId.localeCompare(b.offeringId) ||
    a.deploymentId.localeCompare(b.deploymentId) ||
    a.providerId.localeCompare(b.providerId)
  );
}
