export const RELATIONSHIP_KINDS = [
  "brand",
  "operator",
  "contracting",
  "parent",
  "subsidiary",
  "unknown",
] as const;

export type RelationshipKind = (typeof RELATIONSHIP_KINDS)[number];

export type ProviderIdentity = {
  id: string;
  name: string;
  hqCountry: string | null;
  legalCountry: string | null;
};

export type LegalEntity = {
  id: string;
  legalName: string;
  jurisdictionCountry: string | null;
  registrationNumber: string | null;
};

export type ProviderEntityRelationship = {
  id: string;
  providerId: string;
  legalEntityId: string;
  relationshipKind: RelationshipKind;
  validFrom: string | null;
  validTo: string | null;
};

export type Service = {
  id: string;
  providerId: string;
  slug: string;
  name: string;
  category: string | null;
};

export type Offering = {
  id: string;
  providerId: string;
  serviceId: string;
  name: string;
  status: string | null;
};

export type OfferingVersion = {
  id: string;
  offeringId: string;
  versionOrdinal: number;
  attributes: Record<string, unknown>;
  observedAt: string | null;
  recordedAt: string;
  validFrom: string | null;
  validTo: string | null;
};
