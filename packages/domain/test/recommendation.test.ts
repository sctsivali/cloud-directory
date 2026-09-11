import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateConstraints } from "../src/recommendation/constraints.ts";
import { recommendSubjects } from "../src/recommendation/ranking.ts";
import { CURRENT_METHODOLOGY } from "../src/scoring/methodology.ts";
import { subjectFixture, bound } from "./scoring-fixtures.ts";

describe("hard constraints on offering/deployment grain", () => {
  it("excludes a present mismatch and never uses provider HQ as a substitute", () => {
    const subject = subjectFixture({
      providerId: "hq-indonesia",
      deploymentCountry: bound("present", "Singapore"),
      primaryResidency: bound("present", "Singapore"),
      contractingEntity: bound("present", {
        id: "le-sg",
        jurisdictionCountry: "Singapore",
        legalName: "Pte Ltd",
      }),
      facility: bound("present", {
        id: "fac-sg",
        name: "SG1",
        country: "Singapore",
        named: true,
        mapPrecision: "facility_exact",
      }),
    });
    const result = evaluateConstraints(subject, {
      country: "Indonesia",
      legalCountry: "Indonesia",
      requireNamedFacility: true,
      residencyCountry: "Indonesia",
      residencyPlane: "primary",
    });
    assert.equal(result.group, "excluded");
    assert.ok(result.evaluations.some((e) => e.kind === "country" && e.outcome === "fail"));
    assert.ok(result.evaluations.some((e) => e.kind === "legal_entity" && e.outcome === "fail"));
    assert.ok(result.evaluations.some((e) => e.kind === "residency" && e.outcome === "fail"));
    assert.ok(result.reasonCodes.includes("CONSTRAINT_COUNTRY_FAIL"));
    assert.equal(
      result.evaluations.every((e) => e.subjectGrain === "offering" || e.subjectGrain === "deployment"),
      true
    );
  });

  it("sends unknown and conflicting hard constraints to needs_verification, not eligible", () => {
    const unknownCountry = subjectFixture({
      deploymentCountry: bound("unknown", null),
      primaryResidency: bound("unknown", null),
    });
    const conflictingLegal = subjectFixture({
      contractingEntity: bound("conflicting", {
        id: "le-x",
        jurisdictionCountry: "Indonesia",
        legalName: "Conflicted",
      }),
    });
    const unknown = evaluateConstraints(unknownCountry, { country: "Indonesia", residencyCountry: "Indonesia" });
    const conflict = evaluateConstraints(conflictingLegal, { legalCountry: "Indonesia" });
    assert.equal(unknown.group, "needs_verification");
    assert.ok(unknown.reasonCodes.includes("CONSTRAINT_COUNTRY_UNKNOWN"));
    assert.equal(conflict.group, "needs_verification");
    assert.ok(conflict.reasonCodes.includes("CONSTRAINT_LEGAL_CONFLICTING"));
  });

  it("does not silently relax a one-country shortlist when only one deployment matches", () => {
    const brunei = subjectFixture({
      offeringId: "off-brunei",
      deploymentId: "dep-brunei",
      providerId: "solo-brunei",
      deploymentCountry: bound("present", "Brunei"),
      primaryResidency: bound("present", "Brunei"),
      contractingEntity: bound("present", {
        id: "le-bn",
        jurisdictionCountry: "Brunei",
        legalName: "Sdn",
      }),
      facility: bound("present", {
        id: "fac-bn",
        name: "BN1",
        country: "Brunei",
        named: true,
        mapPrecision: "campus",
      }),
    });
    const indonesia = subjectFixture({
      offeringId: "off-id",
      deploymentId: "dep-id",
      providerId: "local-packages",
      deploymentCountry: bound("present", "Indonesia"),
      primaryResidency: bound("present", "Indonesia"),
    });
    const ranked = recommendSubjects({
      subjects: [indonesia, brunei],
      constraints: { country: "Brunei", residencyCountry: "Brunei" },
      methodology: CURRENT_METHODOLOGY,
      dataRevision: "rev-bn",
    });
    assert.deepEqual(
      ranked.eligible.map((r) => r.offeringId),
      ["off-brunei"]
    );
    assert.deepEqual(
      ranked.excluded.map((r) => r.offeringId),
      ["off-id"]
    );
    assert.equal(ranked.eligible.length, 1);
    assert.ok(!ranked.eligible.some((r) => r.providerId === "local-packages"));
  });

  it("requires a named facility on the deployment, not a city-only disclosure", () => {
    const cityOnly = subjectFixture({
      facility: bound("present", {
        id: "city-1",
        name: "",
        country: "Indonesia",
        named: false,
        mapPrecision: "city_centroid",
      }),
    });
    const result = evaluateConstraints(cityOnly, { requireNamedFacility: true });
    assert.equal(result.group, "excluded");
    assert.ok(result.reasonCodes.includes("CONSTRAINT_FACILITY_FAIL"));
  });
});
