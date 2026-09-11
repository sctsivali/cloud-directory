import {
  ASSESSMENT_STATES,
  KNOWLEDGE_STATES,
  type AssessmentState,
  type KnowledgeState,
} from "./knowledge-state.ts";
import { fail, ok, requireNonEmpty, temporalBoundsOk, type ValidationResult } from "./validation.ts";

export type ClaimSubjectType =
  | "provider"
  | "legal_entity"
  | "service"
  | "offering"
  | "offering_version"
  | "location"
  | "facility"
  | "deployment"
  | "technology"
  | "technology_deployment";

export type FetchSnapshot = {
  id: string;
  body: string;
  fetchedAt: string;
  contentSha256: string;
};

export type EvidenceRef = {
  id: string;
  snapshotId: string;
  excerpt: string;
};

export type EvidenceSourceLink = {
  id: string;
  sourceId: string;
  snapshotId: string;
};

export type ClaimEvidenceLink = {
  claimId: string;
  evidenceId: string;
  stance: "supports" | "contradicts" | "neutral";
};

export type ClaimInput = {
  subjectType: ClaimSubjectType;
  subjectId: string;
  claimType: string;
  value: unknown;
  knowledgeState: KnowledgeState;
  assessmentState: AssessmentState;
  observedAt: string | null;
  recordedAt: string;
  validFrom: string | null;
  validTo: string | null;
};

export function excerptExistsInSnapshot(excerpt: string, snapshotBody: string): boolean {
  if (excerpt.trim() === "") {
    return false;
  }
  return snapshotBody.includes(excerpt);
}

export function validateQuotedExcerpt(evidence: EvidenceRef, snapshot: FetchSnapshot): ValidationResult {
  if (evidence.snapshotId !== snapshot.id) {
    return fail("evidence does not reference this snapshot");
  }
  if (!excerptExistsInSnapshot(evidence.excerpt, snapshot.body)) {
    return fail("quoted excerpt must exist in the referenced immutable snapshot");
  }
  return ok();
}

export function resolveKnowledgeState(
  stances: ReadonlyArray<"supports" | "contradicts" | "neutral">
): KnowledgeState {
  const supports = stances.includes("supports");
  const contradicts = stances.includes("contradicts");
  if (supports && contradicts) {
    return "conflicting";
  }
  if (supports) {
    return "present";
  }
  if (contradicts) {
    return "confirmed_absent";
  }
  return "unknown";
}

export function sourceSupportsClaim(args: {
  sourceId: string;
  claimId: string;
  evidence: EvidenceSourceLink[];
  links: ClaimEvidenceLink[];
}): boolean {
  const fromSource = new Set(
    args.evidence.filter((row) => row.sourceId === args.sourceId).map((row) => row.id)
  );
  return args.links.some(
    (link) =>
      link.claimId === args.claimId && link.stance === "supports" && fromSource.has(link.evidenceId)
  );
}

/** Replay/import clocks must not become observation time. Unknown stays unknown. */
export function assignObservationTime(args: {
  knownObservedAt: string | null;
  importedAt: string;
  replayedAt: string;
}): string | null {
  void args.importedAt;
  void args.replayedAt;
  return args.knownObservedAt;
}

export function canPresentAsFreshlyVerified(args: {
  assessmentState: AssessmentState;
  validTo: string | null;
  now: string;
}): boolean {
  if (args.assessmentState !== "independently_verified") {
    return false;
  }
  if (args.validTo != null && args.validTo < args.now) {
    return false;
  }
  return true;
}

export function validateClaim(claim: ClaimInput): ValidationResult {
  const errors: string[] = [];
  const subjectErr = requireNonEmpty(claim.subjectId, "subjectId");
  if (subjectErr) errors.push(subjectErr);
  const typeErr = requireNonEmpty(claim.claimType, "claimType");
  if (typeErr) errors.push(typeErr);
  if (!(KNOWLEDGE_STATES as readonly string[]).includes(claim.knowledgeState)) {
    errors.push(`unsupported knowledgeState: ${claim.knowledgeState}`);
  }
  if (!(ASSESSMENT_STATES as readonly string[]).includes(claim.assessmentState)) {
    errors.push(`unsupported assessmentState: ${claim.assessmentState}`);
  }
  if (!temporalBoundsOk(claim.validFrom, claim.validTo)) {
    errors.push("validTo must not precede validFrom");
  }
  if (claim.knowledgeState === "unknown" && claim.assessmentState === "independently_verified") {
    errors.push("unknown cannot be independently verified");
  }
  if (claim.assessmentState === "independently_verified" && claim.observedAt == null) {
    errors.push("independently_verified requires observedAt");
  }
  if (errors.length) return fail(...errors);
  return ok();
}
