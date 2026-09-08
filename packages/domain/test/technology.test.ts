import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TECHNOLOGY_SCOPES,
  technologyAppliesToOffering,
  validateTechnology,
  validateTechnologyDeployment,
} from "../src/technology.ts";
import type { Technology, TechnologyDeployment } from "../src/technology.ts";

const kvm: Technology = {
  id: "tech-kvm",
  slug: "kvm",
  name: "KVM",
  category: "hypervisor",
};

const offering = {
  id: "off-1",
  providerId: "local-packages",
  serviceId: "svc-1",
};

describe("technology catalog and scoped deployments", () => {
  it("allows provider, service, offering, and deployment scopes", () => {
    assert.deepEqual(TECHNOLOGY_SCOPES, ["provider", "service", "offering", "deployment"]);
    assert.equal(validateTechnology(kvm).ok, true);
    assert.equal(validateTechnology({ ...kvm, slug: "" }).ok, false);
  });

  it("does not inherit provider-level technology onto offerings without universal-scope evidence", () => {
    const providerScoped: TechnologyDeployment = {
      id: "td-1",
      technologyId: kvm.id,
      technologyVersionId: null,
      scope: "provider",
      scopeId: offering.providerId,
      hasUniversalScopeEvidence: false,
    };
    assert.equal(technologyAppliesToOffering(providerScoped, offering), false);
    assert.equal(validateTechnologyDeployment(providerScoped).ok, true);
  });

  it("inherits to offerings only with explicit universal-scope evidence", () => {
    const withEvidence: TechnologyDeployment = {
      id: "td-2",
      technologyId: kvm.id,
      technologyVersionId: null,
      scope: "provider",
      scopeId: offering.providerId,
      hasUniversalScopeEvidence: true,
    };
    assert.equal(technologyAppliesToOffering(withEvidence, offering), true);
    const serviceScoped: TechnologyDeployment = {
      id: "td-3",
      technologyId: kvm.id,
      technologyVersionId: "tv-1",
      scope: "service",
      scopeId: offering.serviceId,
      hasUniversalScopeEvidence: false,
    };
    assert.equal(technologyAppliesToOffering(serviceScoped, offering), false);
    assert.equal(
      technologyAppliesToOffering({ ...serviceScoped, hasUniversalScopeEvidence: true }, offering),
      true
    );
  });

  it("applies a directly scoped offering or deployment without inheritance", () => {
    const offeringScoped: TechnologyDeployment = {
      id: "td-4",
      technologyId: kvm.id,
      technologyVersionId: null,
      scope: "offering",
      scopeId: offering.id,
      hasUniversalScopeEvidence: false,
    };
    assert.equal(technologyAppliesToOffering(offeringScoped, offering), true);
    assert.equal(
      technologyAppliesToOffering({ ...offeringScoped, scopeId: "other-offering" }, offering),
      false
    );
  });
});
