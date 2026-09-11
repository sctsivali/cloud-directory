import { getCountry, requireRegisteredIso2 } from "./countries.ts";
import { INTELLIGENCE_RULESET_HASH } from "./methodology.ts";
import { filterFacts, isStaleAt, isVerified, resolveFactCountry } from "./trends.ts";
import { projectPublicTimelineEvent } from "../revisions/public-projection.ts";
import {
  INTELLIGENCE_METHODOLOGY_ID,
  type IntelligenceQuery,
  type TimelineDocument,
  type TimelineEvent,
  type VerifiedFact,
} from "./types.ts";

function compareEvents(a: TimelineEvent, b: TimelineEvent): number {
  const observed = a.observedAt.localeCompare(b.observedAt);
  if (observed !== 0) return observed;
  const published = a.publishedAt.localeCompare(b.publishedAt);
  if (published !== 0) return published;
  return a.receiptId.localeCompare(b.receiptId);
}

function toEvent(fact: VerifiedFact, asOf: string): TimelineEvent {
  const countryCode = resolveFactCountry(fact);
  return projectPublicTimelineEvent({
    receiptId: fact.receiptId,
    revisionId: fact.revisionId,
    providerId: fact.providerId,
    countryCode,
    country: countryCode ? getCountry(countryCode) : null,
    changeType: fact.changeType,
    entityType: fact.entityType,
    entityId: fact.entityId,
    fieldName: fact.fieldName,
    observedAt: fact.observedAt,
    publishedAt: fact.publishedAt,
    dataRevision: fact.dataRevision,
    methodologyVersion: fact.methodologyVersion,
    verificationState: fact.verificationState,
    knowledgeState: fact.knowledgeState,
    afterValue: fact.afterValue,
    beforeValue: fact.beforeValue,
    stale: isStaleAt(fact, asOf),
    conflict: fact.knowledgeState === "conflicting",
    valueSensitivity: fact.valueSensitivity === "redacted" ? "redacted" : "public",
  });
}

function verifiedInWindow(facts: VerifiedFact[], window: { start: string; end: string }): VerifiedFact[] {
  return facts.filter(
    (fact) => isVerified(fact) && fact.observedAt >= window.start && fact.observedAt < window.end
  );
}

export function buildProviderTimeline(query: IntelligenceQuery & { providerId: string }): TimelineDocument {
  if (!query.providerId) {
    throw new Error("providerId is required");
  }
  if (!query.window) {
    return {
      kind: "provider_timeline",
      providerId: query.providerId,
      countryCode: query.countryCode ?? null,
      country: query.countryCode ? getCountry(query.countryCode) : null,
      events: [],
      dataRevision: query.dataRevision ?? "unspecified",
      methodologyVersion: query.methodologyVersion ?? INTELLIGENCE_METHODOLOGY_ID,
      methodologyHash: INTELLIGENCE_RULESET_HASH,
    };
  }
  const scoped = verifiedInWindow(filterFacts({ ...query, providerId: query.providerId }), query.window);
  const asOf = query.window.end;
  const events = scoped.map((fact) => toEvent(fact, asOf)).sort(compareEvents);
  return {
    kind: "provider_timeline",
    providerId: query.providerId,
    countryCode: query.countryCode ?? null,
    country: query.countryCode ? getCountry(query.countryCode) : null,
    events,
    dataRevision: query.dataRevision ?? "unspecified",
    methodologyVersion: query.methodologyVersion ?? INTELLIGENCE_METHODOLOGY_ID,
    methodologyHash: INTELLIGENCE_RULESET_HASH,
  };
}

export function buildCountryTimeline(query: IntelligenceQuery & { countryCode: string }): TimelineDocument {
  const country = requireRegisteredIso2(query.countryCode);
  if (!query.window) {
    return {
      kind: "country_timeline",
      providerId: query.providerId ?? null,
      countryCode: country.iso2,
      country,
      events: [],
      dataRevision: query.dataRevision ?? "unspecified",
      methodologyVersion: query.methodologyVersion ?? INTELLIGENCE_METHODOLOGY_ID,
      methodologyHash: INTELLIGENCE_RULESET_HASH,
    };
  }
  const scoped = verifiedInWindow(filterFacts({ ...query, countryCode: country.iso2 }), query.window);
  const asOf = query.window.end;
  const events = scoped.map((fact) => toEvent(fact, asOf)).sort(compareEvents);
  return {
    kind: "country_timeline",
    providerId: query.providerId ?? null,
    countryCode: country.iso2,
    country,
    events,
    dataRevision: query.dataRevision ?? "unspecified",
    methodologyVersion: query.methodologyVersion ?? INTELLIGENCE_METHODOLOGY_ID,
    methodologyHash: INTELLIGENCE_RULESET_HASH,
  };
}
