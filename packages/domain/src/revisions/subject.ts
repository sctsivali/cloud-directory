import type { ProposalSnapshot, PublicationReceipt, RevisionSnapshot } from "./types.ts";
import { sensitivityFor, stableHashId } from "./public-projection.ts";
import { ledgerState } from "./state.ts";

export type DerivedSubject = {
  entityType: string;
  entityId: string;
  fieldName: string;
  afterValue: unknown;
  evidenceSnapshotIds: string[];
  observedAt: string | null;
  changeType: PublicationReceipt["changeType"];
  providerId: string | null;
  sourceId: string | null;
  valueSensitivity: "public" | "redacted";
  titleId: string;
  titleEn: string;
  summaryId: string | null;
  summaryEn: string | null;
  href: string | null;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function evidenceFrom(body: Record<string, unknown>): { ids: string[]; snapshot: string | null } {
  const snapshot = asString(body.snapshotId);
  const evidenceSnapshotIds = Array.isArray(body.evidenceSnapshotIds)
    ? body.evidenceSnapshotIds.filter((row): row is string => typeof row === "string")
    : snapshot
      ? [snapshot]
      : [];
  return { ids: evidenceSnapshotIds, snapshot };
}

function titled(
  entityType: string,
  fieldName: string,
  changeType: PublicationReceipt["changeType"],
  href: string | null
): Pick<DerivedSubject, "titleId" | "titleEn" | "summaryId" | "summaryEn" | "href"> {
  const title = `${entityType} ${fieldName} ${changeType}`;
  return { titleId: title, titleEn: title, summaryId: title, summaryEn: title, href };
}

export function stableOfferingId(providerId: string, serviceId: string, name: string): string {
  return stableHashId("offering", [providerId, serviceId, name]);
}

export function stableLocationId(country: string, city: string): string {
  return stableHashId("location", [country.trim().toUpperCase(), city.trim().toLowerCase()]);
}

export function stableFacilityId(name: string, locationId: string | null): string {
  return stableHashId("facility", [name, locationId]);
}

export function stableTechnologyId(technologyId: string, scope: string, scopeId: string): string {
  return stableHashId("technology", [technologyId, scope, scopeId]);
}

export function parseClaimTarget(claimId: string): { entityType: string; entityId: string; fieldName: string } {
  const first = claimId.indexOf(":");
  const last = claimId.lastIndexOf(":");
  if (first > 0 && last > first) {
    return {
      entityType: claimId.slice(0, first),
      entityId: claimId.slice(first + 1, last),
      fieldName: claimId.slice(last + 1),
    };
  }
  return { entityType: "claim", entityId: claimId, fieldName: "value" };
}

function adaptClaim(body: Record<string, unknown>, changeType: PublicationReceipt["changeType"], hrefFallback: string): DerivedSubject {
  const entityType = asString(body.subjectType) ?? "provider";
  const entityId = asString(body.subjectId) ?? "";
  const fieldName = asString(body.claimType) ?? "value";
  const evidence = evidenceFrom(body);
  const providerId = entityType === "provider" ? entityId : asString(body.providerId);
  return {
    entityType,
    entityId,
    fieldName,
    afterValue: body.value,
    evidenceSnapshotIds: evidence.ids,
    observedAt: asString(body.observedAt),
    changeType,
    providerId,
    sourceId: evidence.snapshot,
    valueSensitivity: sensitivityFor(fieldName),
    ...titled(entityType, fieldName, changeType, providerId ? `/provider/${providerId}` : hrefFallback),
  };
}

function adaptOffering(body: Record<string, unknown>, hrefFallback: string): DerivedSubject {
  const providerId = asString(body.providerId) ?? "";
  const serviceId = asString(body.serviceId) ?? "";
  const name = asString(body.name) ?? "";
  const entityId = stableOfferingId(providerId, serviceId, name);
  const evidence = evidenceFrom(body);
  return {
    entityType: "offering",
    entityId,
    fieldName: "offering",
    afterValue: {
      name,
      providerId,
      serviceId,
      status: asString(body.status),
      knowledgeState: ledgerState(body).knowledgeState,
    },
    evidenceSnapshotIds: evidence.ids,
    observedAt: asString(body.observedAt),
    changeType: "create",
    providerId,
    sourceId: evidence.snapshot,
    valueSensitivity: "public",
    ...titled("offering", "offering", "create", providerId ? `/provider/${providerId}` : hrefFallback),
  };
}

function adaptPrice(body: Record<string, unknown>, hrefFallback: string): DerivedSubject {
  const offeringId = asString(body.offeringId) ?? "";
  const evidence = evidenceFrom(body);
  return {
    entityType: "price",
    entityId: offeringId,
    fieldName: "price",
    afterValue: {
      offeringId,
      amount: asNumber(body.amount),
      currency: asString(body.currency),
      billingUnit: asString(body.billingUnit),
      commitment: asString(body.commitment),
      promo: asBool(body.promo) ?? false,
      comparable: true,
      knowledgeState: ledgerState(body).knowledgeState,
    },
    evidenceSnapshotIds: evidence.ids,
    observedAt: asString(body.observedAt),
    changeType: "create",
    providerId: null,
    sourceId: evidence.snapshot,
    valueSensitivity: "public",
    ...titled("price", "price", "create", hrefFallback),
  };
}

function adaptLocation(body: Record<string, unknown>, hrefFallback: string): DerivedSubject {
  const city = asString(body.city) ?? "";
  const country = asString(body.country) ?? "";
  const entityId = stableLocationId(country, city);
  const evidence = evidenceFrom(body);
  const href = /^[A-Za-z]{2}$/.test(country) ? `/country/${country.toUpperCase()}` : hrefFallback;
  return {
    entityType: "location",
    entityId,
    fieldName: "location",
    afterValue: {
      city,
      country,
      mapPrecision: asString(body.mapPrecision) ?? "undisclosed",
      lat: asNumber(body.lat),
      lng: asNumber(body.lng),
      knowledgeState: ledgerState(body).knowledgeState,
    },
    evidenceSnapshotIds: evidence.ids,
    observedAt: asString(body.observedAt),
    changeType: "create",
    providerId: null,
    sourceId: evidence.snapshot,
    valueSensitivity: "public",
    ...titled("location", "location", "create", href),
  };
}

function adaptFacility(body: Record<string, unknown>, hrefFallback: string): DerivedSubject {
  const name = asString(body.name) ?? "";
  const locationId = asString(body.locationId);
  const entityId = stableFacilityId(name, locationId);
  const evidence = evidenceFrom(body);
  return {
    entityType: "facility",
    entityId,
    fieldName: "facility",
    afterValue: {
      name,
      locationId,
      address: asString(body.address),
      operator: asString(body.operator),
      lat: asNumber(body.lat),
      lng: asNumber(body.lng),
      mapPrecision: asString(body.mapPrecision) ?? "undisclosed",
      facilityId: entityId,
      knowledgeState: ledgerState(body).knowledgeState,
    },
    evidenceSnapshotIds: evidence.ids,
    observedAt: asString(body.observedAt),
    changeType: "create",
    providerId: null,
    sourceId: evidence.snapshot,
    valueSensitivity: "public",
    ...titled("facility", "facility", "create", hrefFallback),
  };
}

function adaptTechnology(body: Record<string, unknown>, hrefFallback: string): DerivedSubject {
  const technologyId = asString(body.technologyId) ?? "";
  const scope = asString(body.scope) ?? "offering";
  const scopeId = asString(body.scopeId) ?? "";
  const entityId = stableTechnologyId(technologyId, scope, scopeId);
  const evidence = evidenceFrom(body);
  const providerId = scope === "provider" ? scopeId : null;
  return {
    entityType: "technology",
    entityId,
    fieldName: "technology",
    afterValue: {
      technologyId,
      technologyVersionId: asString(body.technologyVersionId),
      scope,
      scopeId,
      hasUniversalScopeEvidence: body.hasUniversalScopeEvidence === true,
      slug: technologyId,
      technologySlug: technologyId,
      knowledgeState: ledgerState(body).knowledgeState,
    },
    evidenceSnapshotIds: evidence.ids,
    observedAt: asString(body.observedAt),
    changeType: "create",
    providerId,
    sourceId: evidence.snapshot,
    valueSensitivity: "public",
    ...titled("technology", "technology", "create", providerId ? `/provider/${providerId}` : hrefFallback),
  };
}

function adaptRetraction(body: Record<string, unknown>, hrefFallback: string): DerivedSubject {
  const claimId = asString(body.claimId) ?? "";
  const target = parseClaimTarget(claimId);
  const evidence = evidenceFrom(body);
  const providerId = target.entityType === "provider" ? target.entityId : null;
  return {
    entityType: target.entityType,
    entityId: target.entityId,
    fieldName: target.fieldName,
    afterValue: null,
    evidenceSnapshotIds: evidence.ids,
    observedAt: asString(body.observedAt),
    changeType: "retract",
    providerId,
    sourceId: evidence.snapshot,
    valueSensitivity: sensitivityFor(target.fieldName),
    ...titled(target.entityType, target.fieldName, "retract", providerId ? `/provider/${providerId}` : hrefFallback),
  };
}

const ADAPTERS: Record<string, (body: Record<string, unknown>, hrefFallback: string) => DerivedSubject> = {
  "directory.propose_claim": (body, href) => adaptClaim(body, "create", href),
  "directory.propose_offering": adaptOffering,
  "directory.propose_price_observation": adaptPrice,
  "directory.propose_location": adaptLocation,
  "directory.propose_facility": adaptFacility,
  "directory.propose_technology_deployment": adaptTechnology,
  "directory.propose_retraction": adaptRetraction,
};

export function deriveSubject(
  proposal: ProposalSnapshot,
  revision: RevisionSnapshot,
  rollbackOfReceiptId: string | null
): DerivedSubject & Required<import("./types.ts").TypedLedgerState> {
  const body = { ...proposal.body, ...revision.body };
  const hrefFallback = `/revisions/${revision.id}`;
  const adapter = ADAPTERS[proposal.toolName];
  const derived = adapter ? adapter(body, hrefFallback) : adaptClaim(body, "create", hrefFallback);
  if (rollbackOfReceiptId) {
    return { ...derived, ...ledgerState({}), changeType: "rollback" };
  }
  return { ...derived, ...ledgerState(body) };
}
