export const CLAIM_FIELDS = {
  subjectType: "provider",
  subjectId: "local-packages",
  claimType: "hypervisor",
  value: { text: "KVM" },
  knowledgeState: "present",
  assessmentState: "extracted",
} as const;

export function claimRevisionBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    subjectType: CLAIM_FIELDS.subjectType,
    subjectId: CLAIM_FIELDS.subjectId,
    claimType: CLAIM_FIELDS.claimType,
    value: { ...CLAIM_FIELDS.value },
    knowledgeState: CLAIM_FIELDS.knowledgeState,
    assessmentState: CLAIM_FIELDS.assessmentState,
    ...overrides,
  };
}
