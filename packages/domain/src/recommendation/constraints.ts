import type {
  ConstraintEvaluation,
  ConstraintKind,
  ConstraintResult,
  HardConstraints,
  OfferingDeploymentSubject,
  RecommendationGroup,
} from "../scoring/types.ts";
import type { KnowledgeState } from "../knowledge-state.ts";

function outcomeFromState(
  state: KnowledgeState,
  presentPass: boolean | null
): ConstraintEvaluation["outcome"] {
  if (state === "conflicting") return "conflict";
  if (state === "unknown" || state === "not_applicable") return "unknown";
  if (state === "confirmed_absent") return "fail";
  if (presentPass === true) return "pass";
  if (presentPass === false) return "fail";
  return "unknown";
}

function reasonFor(kind: ConstraintKind, outcome: ConstraintEvaluation["outcome"]): string {
  const prefix =
    kind === "country"
      ? "CONSTRAINT_COUNTRY"
      : kind === "legal_entity"
        ? "CONSTRAINT_LEGAL"
        : kind === "facility"
          ? "CONSTRAINT_FACILITY"
          : "CONSTRAINT_RESIDENCY";
  if (outcome === "pass") return `${prefix}_PASS`;
  if (outcome === "fail") return `${prefix}_FAIL`;
  if (outcome === "conflict") return `${prefix}_CONFLICTING`;
  return `${prefix}_UNKNOWN`;
}

function evalCountry(subject: OfferingDeploymentSubject, required: string): ConstraintEvaluation {
  const fact = subject.deploymentCountry;
  const presentPass =
    fact.knowledgeState === "present" && fact.value != null ? fact.value === required : null;
  const outcome = outcomeFromState(fact.knowledgeState, presentPass);
  return {
    kind: "country",
    outcome,
    reasonCodes: [reasonFor("country", outcome)],
    subjectGrain: "deployment",
  };
}

function evalLegal(subject: OfferingDeploymentSubject, required: string): ConstraintEvaluation {
  const fact = subject.contractingEntity;
  const presentPass =
    fact.knowledgeState === "present" && fact.value != null
      ? fact.value.jurisdictionCountry === required
      : null;
  const outcome = outcomeFromState(fact.knowledgeState, presentPass);
  return {
    kind: "legal_entity",
    outcome,
    reasonCodes: [reasonFor("legal_entity", outcome)],
    subjectGrain: "offering",
  };
}

function evalFacility(subject: OfferingDeploymentSubject): ConstraintEvaluation {
  const fact = subject.facility;
  const named =
    fact.value?.named === true &&
    (fact.value.mapPrecision === "facility_exact" || fact.value.mapPrecision === "campus") &&
    (fact.value.name ?? "").trim() !== "";
  const presentPass = fact.knowledgeState === "present" ? named : null;
  const outcome = outcomeFromState(fact.knowledgeState, presentPass);
  return {
    kind: "facility",
    outcome,
    reasonCodes: [reasonFor("facility", outcome)],
    subjectGrain: "deployment",
  };
}

function evalResidency(
  subject: OfferingDeploymentSubject,
  required: string,
  plane: NonNullable<HardConstraints["residencyPlane"]>
): ConstraintEvaluation {
  const fact =
    plane === "backup"
      ? subject.backupResidency
      : plane === "metadata"
        ? subject.metadataResidency
        : subject.primaryResidency;
  const presentPass =
    fact.knowledgeState === "present" && fact.value != null ? fact.value === required : null;
  const outcome = outcomeFromState(fact.knowledgeState, presentPass);
  return {
    kind: "residency",
    outcome,
    reasonCodes: [reasonFor("residency", outcome)],
    subjectGrain: "deployment",
  };
}

export function evaluateConstraints(
  subject: OfferingDeploymentSubject,
  constraints: HardConstraints
): ConstraintResult {
  const evaluations: ConstraintEvaluation[] = [];
  if (constraints.country) {
    evaluations.push(evalCountry(subject, constraints.country));
  }
  if (constraints.legalCountry) {
    evaluations.push(evalLegal(subject, constraints.legalCountry));
  }
  if (constraints.requireNamedFacility) {
    evaluations.push(evalFacility(subject));
  }
  if (constraints.residencyCountry) {
    evaluations.push(
      evalResidency(subject, constraints.residencyCountry, constraints.residencyPlane ?? "primary")
    );
  }

  const reasonCodes = evaluations.flatMap((e) => e.reasonCodes);
  let group: RecommendationGroup = "eligible";
  if (evaluations.some((e) => e.outcome === "fail")) {
    group = "excluded";
  } else if (evaluations.some((e) => e.outcome === "unknown" || e.outcome === "conflict")) {
    group = "needs_verification";
  }

  return { group, evaluations, reasonCodes };
}

export function hasHardConstraints(constraints: HardConstraints): boolean {
  return Boolean(
    constraints.country ||
      constraints.legalCountry ||
      constraints.requireNamedFacility ||
      constraints.residencyCountry
  );
}
