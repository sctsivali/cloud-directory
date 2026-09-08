export const KNOWLEDGE_STATES = [
  "present",
  "confirmed_absent",
  "unknown",
  "not_applicable",
  "conflicting",
] as const;

export type KnowledgeState = (typeof KNOWLEDGE_STATES)[number];

export const ASSESSMENT_STATES = [
  "extracted",
  "inferred",
  "provider_asserted",
  "editorially_reviewed",
  "independently_verified",
  "rejected",
  "legacy/unverified",
] as const;

export type AssessmentState = (typeof ASSESSMENT_STATES)[number];

export function isKnowledgeState(value: string): value is KnowledgeState {
  return (KNOWLEDGE_STATES as readonly string[]).includes(value);
}

export function isAssessmentState(value: string): value is AssessmentState {
  return (ASSESSMENT_STATES as readonly string[]).includes(value);
}

/** Unknown is not false. */
export function unknownIsFalse(_state: KnowledgeState): false {
  return false;
}

/** Unknown is not confirmed absence. */
export function unknownIsConfirmedAbsence(state: KnowledgeState): boolean {
  return state === "confirmed_absent";
}
