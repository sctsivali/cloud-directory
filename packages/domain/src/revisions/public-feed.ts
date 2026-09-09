import type { ChangeEvent } from "./types.ts";
import { redactPublicPair } from "./public-projection.ts";

export type LegacyDirectoryUpdate = {
  id: number;
  kind: "discovered" | "updated";
  provider_id: string | null;
  title_id: string;
  title_en: string;
  summary_id: string | null;
  summary_en: string | null;
  href: string | null;
  occurred_at: string;
};

export type PublicDirectoryUpdate = {
  id: string | number;
  kind: "discovered" | "updated" | "correction" | "rollback";
  change_type: string;
  provider_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  field: string | null;
  old_value: unknown;
  new_value: unknown;
  value_sensitivity: "public" | "redacted";
  source: string | null;
  evidence_snapshot_ids: string[];
  detected_at: string | null;
  observed_at: string | null;
  reviewed_at: string | null;
  published_at: string | null;
  revision_id: string | null;
  revision_href: string | null;
  correction_of: string | null;
  title_id: string;
  title_en: string;
  summary_id: string | null;
  summary_en: string | null;
  href: string | null;
  occurred_at: string;
};

function kindForChange(changeType: string): PublicDirectoryUpdate["kind"] {
  if (changeType === "rollback") return "rollback";
  if (changeType === "correction") return "correction";
  if (changeType === "create") return "discovered";
  return "updated";
}

export function toPublicUpdate(event: ChangeEvent): PublicDirectoryUpdate {
  const values = redactPublicPair(event.oldValue, event.newValue, event.valueSensitivity);
  return {
    id: event.id,
    kind: kindForChange(event.changeType),
    change_type: event.changeType,
    provider_id: event.providerId,
    entity_type: event.entityType,
    entity_id: event.entityId,
    field: event.fieldName,
    old_value: values.beforeValue,
    new_value: values.afterValue,
    value_sensitivity: values.valueSensitivity,
    source: event.sourceId,
    evidence_snapshot_ids: [...event.evidenceSnapshotIds],
    detected_at: event.detectedAt,
    observed_at: event.observedAt,
    reviewed_at: event.reviewedAt,
    published_at: event.publishedAt,
    revision_id: event.revisionId,
    revision_href: `/revisions/${event.revisionId}`,
    correction_of: event.correctionOfEventId,
    title_id: event.titleId,
    title_en: event.titleEn,
    summary_id: event.summaryId,
    summary_en: event.summaryEn,
    href: event.href,
    occurred_at: event.publishedAt,
  };
}

export function toLegacyPublicUpdate(row: LegacyDirectoryUpdate): PublicDirectoryUpdate {
  return {
    id: row.id,
    kind: row.kind,
    change_type: row.kind,
    provider_id: row.provider_id,
    entity_type: row.provider_id ? "provider" : null,
    entity_id: row.provider_id,
    field: null,
    old_value: null,
    new_value: null,
    value_sensitivity: "public",
    source: null,
    evidence_snapshot_ids: [],
    detected_at: null,
    observed_at: null,
    reviewed_at: null,
    published_at: row.occurred_at,
    revision_id: null,
    revision_href: null,
    correction_of: null,
    title_id: row.title_id,
    title_en: row.title_en,
    summary_id: row.summary_id,
    summary_en: row.summary_en,
    href: row.href,
    occurred_at: row.occurred_at,
  };
}

export function selectPublicUpdates(
  events: ChangeEvent[],
  fallback: LegacyDirectoryUpdate[]
): PublicDirectoryUpdate[] {
  if (events.length > 0) return events.map(toPublicUpdate);
  return fallback.map(toLegacyPublicUpdate);
}

export function toApiUpdate(update: PublicDirectoryUpdate): PublicDirectoryUpdate {
  return { ...update, evidence_snapshot_ids: [...update.evidence_snapshot_ids] };
}
