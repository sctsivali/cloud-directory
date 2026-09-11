import { latestStateByEntity } from "../intelligence/trends.ts";
import type { TimelineDocument, TimelineEvent, VerifiedFact } from "../intelligence/types.ts";
import { sha256Hex } from "../scoring/hash.ts";

export type PublicValueSensitivity = "public" | "redacted";

const REDACTED_FIELDS = ["password", "secret", "token", "credential", "private_key"];

export function sensitivityFor(fieldName: string): PublicValueSensitivity {
  return REDACTED_FIELDS.includes(fieldName) ? "redacted" : "public";
}

export function projectPublicCurrentClaim<T extends { claim_type: string; value: unknown }>(claim: T) {
  const values = redactPublicPair(null, claim.value, sensitivityFor(claim.claim_type));
  return { ...claim, value: values.afterValue, value_sensitivity: values.valueSensitivity };
}

export type PublicReadEntity = {
  entityType: string;
  entityId: string;
  fieldName: string;
  providerId: string | null;
  verificationState: string;
  changeType: string;
  value: unknown;
  beforeValue: unknown;
  valueSensitivity: PublicValueSensitivity;
  receiptId: string;
  revisionId: string;
  knowledgeState: string;
};

export type PublicReadModel = {
  claims: PublicReadEntity[];
  offerings: PublicReadEntity[];
  prices: PublicReadEntity[];
  locations: PublicReadEntity[];
  facilities: PublicReadEntity[];
  technologies: PublicReadEntity[];
};

export function redactPublicPair(
  before: unknown,
  after: unknown,
  sensitivity: PublicValueSensitivity | string | null | undefined
): { beforeValue: unknown; afterValue: unknown; valueSensitivity: PublicValueSensitivity } {
  const valueSensitivity: PublicValueSensitivity = sensitivity === "redacted" ? "redacted" : "public";
  if (valueSensitivity === "redacted") {
    return { beforeValue: null, afterValue: null, valueSensitivity };
  }
  return { beforeValue: before, afterValue: after, valueSensitivity };
}

export function projectPublicTimelineEvent(event: TimelineEvent): TimelineEvent {
  const values = redactPublicPair(event.beforeValue, event.afterValue, event.valueSensitivity);
  return {
    receiptId: event.receiptId,
    revisionId: event.revisionId,
    providerId: event.providerId,
    countryCode: event.countryCode,
    country: event.country,
    changeType: event.changeType,
    entityType: event.entityType,
    entityId: event.entityId,
    fieldName: event.fieldName,
    observedAt: event.observedAt,
    publishedAt: event.publishedAt,
    dataRevision: event.dataRevision,
    methodologyVersion: event.methodologyVersion,
    verificationState: event.verificationState,
    knowledgeState: event.knowledgeState,
    stale: event.stale,
    conflict: event.conflict,
    valueSensitivity: values.valueSensitivity,
    beforeValue: values.beforeValue,
    afterValue: values.afterValue,
  };
}

export function projectPublicTimelineDocument(doc: TimelineDocument): TimelineDocument {
  return {
    kind: doc.kind,
    providerId: doc.providerId,
    countryCode: doc.countryCode,
    country: doc.country,
    events: doc.events.map(projectPublicTimelineEvent),
    dataRevision: doc.dataRevision,
    methodologyVersion: doc.methodologyVersion,
    methodologyHash: doc.methodologyHash,
  };
}

function asEntity(fact: VerifiedFact): PublicReadEntity {
  const values = redactPublicPair(fact.beforeValue, fact.afterValue, fact.valueSensitivity);
  return {
    entityType: fact.entityType,
    entityId: fact.entityId,
    fieldName: fact.fieldName,
    providerId: fact.providerId,
    verificationState: fact.verificationState,
    changeType: fact.changeType,
    value: values.afterValue,
    beforeValue: values.beforeValue,
    valueSensitivity: values.valueSensitivity,
    receiptId: fact.receiptId,
    revisionId: fact.revisionId,
    knowledgeState: fact.knowledgeState,
  };
}

function bucketOf(entity: PublicReadEntity): keyof PublicReadModel {
  if (entity.entityType === "offering" && entity.fieldName === "offering") return "offerings";
  if (entity.entityType === "price") return "prices";
  if (entity.entityType === "location") return "locations";
  if (entity.entityType === "facility") return "facilities";
  if (entity.entityType === "technology") return "technologies";
  return "claims";
}

export function projectVerifiedPublicReadModel(facts: VerifiedFact[]): PublicReadModel {
  const latest = latestStateByEntity(facts, "9999-12-31T23:59:59.000Z");
  const model: PublicReadModel = {
    claims: [],
    offerings: [],
    prices: [],
    locations: [],
    facilities: [],
    technologies: [],
  };
  for (const fact of latest.values()) {
    if (fact.verificationState !== "verified") continue;
    const entity = asEntity(fact);
    model[bucketOf(entity)].push(entity);
  }
  return model;
}

export function stableHashId(kind: string, parts: Array<string | number | null | undefined>): string {
  return `${kind}_${sha256Hex([kind, ...parts.map((part) => String(part ?? ""))].join("\0")).slice(0, 24)}`;
}
