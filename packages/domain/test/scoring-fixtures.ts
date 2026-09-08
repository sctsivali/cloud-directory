import type { AssessmentState } from "../src/knowledge-state.ts";
import type { KnowledgeState } from "../src/knowledge-state.ts";
import { CURRENT_METHODOLOGY } from "../src/scoring/methodology.ts";
import type { EvidenceItem, OfferingDeploymentSubject } from "../src/scoring/types.ts";

export function bound<T>(
  knowledgeState: KnowledgeState,
  value: T | null
): { knowledgeState: KnowledgeState; value: T | null; evidenceCount: number } {
  return {
    knowledgeState,
    value,
    evidenceCount: knowledgeState === "unknown" ? 0 : 1,
  };
}

export function requiredEvidenceItems(
  assessmentState: AssessmentState = "independently_verified"
): EvidenceItem[] {
  return CURRENT_METHODOLOGY.ruleset.requiredEvidenceClaimTypes.map((claimType) => ({
    claimType,
    assessmentState,
    knowledgeState: "present" as const,
    independent: true,
    freshnessDays: 10,
    excerptPresent: true,
  }));
}

export function subjectFixture(
  overrides: Partial<OfferingDeploymentSubject> = {}
): OfferingDeploymentSubject {
  return {
    offeringId: "off-1",
    deploymentId: "dep-1",
    providerId: "prov-1",
    offeringName: "Compute S",
    providerName: "Nusantara Compute",
    serviceId: "svc-1",
    deploymentCountry: bound("present", "Indonesia"),
    primaryResidency: bound("present", "Indonesia"),
    backupResidency: bound("present", "Indonesia"),
    metadataResidency: bound("present", "Indonesia"),
    contractingEntity: bound("present", {
      id: "le-1",
      jurisdictionCountry: "Indonesia",
      legalName: "PT Nusantara Compute",
    }),
    administrativeAccess: bound("present", { localAdmin: true, country: "Indonesia" }),
    keyControl: bound("present", { customerHeld: true, country: "Indonesia" }),
    facility: bound("present", {
      id: "fac-1",
      name: "Nusantara DC Campus",
      country: "Indonesia",
      named: true,
      mapPrecision: "facility_exact",
    }),
    technologies: [
      {
        slug: "kvm",
        category: "hypervisor",
        knowledgeState: "present",
        scope: "offering",
        scopeId: "off-1",
        hasUniversalScopeEvidence: false,
        appliesToSubject: true,
      },
    ],
    commercial: bound("present", {
      amount: 8.5,
      currency: "USD",
      billingUnit: "month",
      commitment: null,
      promo: false,
      comparable: true,
    }),
    evidenceItems: requiredEvidenceItems(),
    ...overrides,
  };
}
