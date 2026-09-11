import {
  RELATIONSHIP_KINDS,
  type LegalEntity,
  type Offering,
  type OfferingVersion,
  type ProviderEntityRelationship,
  type Service,
} from "./entities.ts";
import { fail, ok, requireNonEmpty, temporalBoundsOk, type ValidationResult } from "./validation.ts";

export { RELATIONSHIP_KINDS } from "./entities.ts";

/** A provider legal_country string is never sufficient to mint a legal entity. */
export function legalCountryDoesNotCreateLegalEntity(_legalCountry: string | null): true {
  return true;
}

export function validateLegalEntity(entity: LegalEntity): ValidationResult {
  const errors: string[] = [];
  const nameErr = requireNonEmpty(entity.legalName, "legalName");
  if (nameErr) errors.push(nameErr);
  const idErr = requireNonEmpty(entity.id, "id");
  if (idErr) errors.push(idErr);
  if (errors.length) return fail(...errors);
  return ok();
}

export function validateProviderEntityRelationship(
  rel: ProviderEntityRelationship
): ValidationResult {
  const errors: string[] = [];
  const providerErr = requireNonEmpty(rel.providerId, "providerId");
  if (providerErr) errors.push(providerErr);
  const entityErr = requireNonEmpty(rel.legalEntityId, "legalEntityId");
  if (entityErr) errors.push(entityErr);
  if (!(RELATIONSHIP_KINDS as readonly string[]).includes(rel.relationshipKind)) {
    errors.push(`unsupported relationshipKind: ${rel.relationshipKind}`);
  }
  if (!temporalBoundsOk(rel.validFrom, rel.validTo)) {
    errors.push("validTo must not precede validFrom");
  }
  if (errors.length) return fail(...errors);
  return ok();
}

export function validateService(service: Service): ValidationResult {
  const errors: string[] = [];
  for (const [field, value] of [
    ["id", service.id],
    ["providerId", service.providerId],
    ["slug", service.slug],
    ["name", service.name],
  ] as const) {
    const err = requireNonEmpty(value, field);
    if (err) errors.push(err);
  }
  if (errors.length) return fail(...errors);
  return ok();
}

export function validateOffering(offering: Offering): ValidationResult {
  const errors: string[] = [];
  for (const [field, value] of [
    ["id", offering.id],
    ["providerId", offering.providerId],
    ["serviceId", offering.serviceId],
    ["name", offering.name],
  ] as const) {
    const err = requireNonEmpty(value, field);
    if (err) errors.push(err);
  }
  if (errors.length) return fail(...errors);
  return ok();
}

export function validateOfferingVersion(version: OfferingVersion): ValidationResult {
  const errors: string[] = [];
  const idErr = requireNonEmpty(version.id, "id");
  if (idErr) errors.push(idErr);
  const offeringErr = requireNonEmpty(version.offeringId, "offeringId");
  if (offeringErr) errors.push(offeringErr);
  if (!Number.isInteger(version.versionOrdinal) || version.versionOrdinal < 1) {
    errors.push("versionOrdinal must be an integer >= 1");
  }
  if (!temporalBoundsOk(version.validFrom, version.validTo)) {
    errors.push("validTo must not precede validFrom");
  }
  if (errors.length) return fail(...errors);
  return ok();
}
