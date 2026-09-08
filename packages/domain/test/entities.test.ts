import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RELATIONSHIP_KINDS,
  legalCountryDoesNotCreateLegalEntity,
  validateLegalEntity,
  validateOffering,
  validateOfferingVersion,
  validateProviderEntityRelationship,
  validateService,
} from "../src/entity-validation.ts";
import type { LegalEntity, Offering, OfferingVersion, ProviderEntityRelationship, Service } from "../src/entities.ts";

const entity: LegalEntity = {
  id: "le-1",
  legalName: "PT Nusantara Compute",
  jurisdictionCountry: "Indonesia",
  registrationNumber: "123456789",
};

const service: Service = {
  id: "svc-1",
  providerId: "local-packages",
  slug: "compute",
  name: "Compute",
  category: "iaas",
};

const offering: Offering = {
  id: "off-1",
  providerId: "local-packages",
  serviceId: "svc-1",
  name: "Compute S",
  status: "OK",
};

describe("identity and catalog entities", () => {
  it("accepts a named legal entity with jurisdiction", () => {
    const result = validateLegalEntity(entity);
    assert.equal(result.ok, true);
  });

  it("rejects an empty legal name", () => {
    const result = validateLegalEntity({ ...entity, legalName: "  " });
    assert.equal(result.ok, false);
  });

  it("does not treat a provider legal_country string as a legal entity", () => {
    assert.equal(legalCountryDoesNotCreateLegalEntity("Indonesia"), true);
    assert.equal(legalCountryDoesNotCreateLegalEntity(null), true);
    const inferred = validateLegalEntity({
      id: "inferred",
      legalName: "",
      jurisdictionCountry: "Indonesia",
      registrationNumber: null,
    });
    assert.equal(inferred.ok, false);
  });

  it("validates provider–entity relationship kinds and temporal bounds", () => {
    assert.ok(RELATIONSHIP_KINDS.includes("contracting"));
    const rel: ProviderEntityRelationship = {
      id: "rel-1",
      providerId: "local-packages",
      legalEntityId: "le-1",
      relationshipKind: "contracting",
      validFrom: "2020-01-01T00:00:00Z",
      validTo: "2021-01-01T00:00:00Z",
    };
    assert.equal(validateProviderEntityRelationship(rel).ok, true);
    assert.equal(
      validateProviderEntityRelationship({ ...rel, validTo: "2019-01-01T00:00:00Z" }).ok,
      false
    );
    assert.equal(
      validateProviderEntityRelationship({ ...rel, relationshipKind: "owner" as ProviderEntityRelationship["relationshipKind"] }).ok,
      false
    );
  });

  it("requires service slug and offering service linkage", () => {
    assert.equal(validateService(service).ok, true);
    assert.equal(validateService({ ...service, slug: "" }).ok, false);
    assert.equal(validateOffering(offering).ok, true);
    assert.equal(validateOffering({ ...offering, serviceId: "" }).ok, false);
  });

  it("preserves offering-version observation time distinct from recorded time", () => {
    const version: OfferingVersion = {
      id: "ov-1",
      offeringId: "off-1",
      versionOrdinal: 1,
      attributes: { price_usd_month: 8.5, currency: "USD" },
      observedAt: "2024-01-15T00:00:00Z",
      recordedAt: "2026-09-09T00:00:00Z",
      validFrom: "2024-01-15T00:00:00Z",
      validTo: null,
    };
    assert.equal(validateOfferingVersion(version).ok, true);
    assert.notEqual(version.observedAt, version.recordedAt);
    assert.equal(validateOfferingVersion({ ...version, versionOrdinal: 0 }).ok, false);
    assert.equal(
      validateOfferingVersion({ ...version, validTo: "2023-01-01T00:00:00Z" }).ok,
      false
    );
  });
});
