import type { KnowledgeState } from "../knowledge-state.ts";
import type { ChangeType, VerificationState, VerifiedFact } from "./types.ts";
import { INTELLIGENCE_METHODOLOGY_ID } from "./types.ts";
import { extractCountryFromValue } from "./countries.ts";

export type LedgerFactRow = {
  receiptId: string;
  revisionId: string;
  changeType: string;
  entityType: string;
  entityId: string;
  fieldName: string;
  providerId?: string | null;
  observedAt?: string | null;
  publishedAt: string;
  verificationState: string;
  afterValue: unknown;
  beforeValue: unknown;
  methodologyVersion?: string | null;
  dataRevision?: string | null;
  supersedesReceiptId?: string | null;
  valueSensitivity?: string | null;
};

function asChangeType(value: string): ChangeType {
  if (value === "create" || value === "update" || value === "retract" || value === "rollback" || value === "correction") {
    return value;
  }
  return "update";
}

function asVerification(value: string): VerificationState {
  if (value === "pending" || value === "verified" || value === "failed" || value === "uncertain" || value === "rolled_back") {
    return value;
  }
  return "pending";
}

function asKnowledge(value: unknown): KnowledgeState {
  if (
    value === "present" ||
    value === "confirmed_absent" ||
    value === "unknown" ||
    value === "not_applicable" ||
    value === "conflicting"
  ) {
    return value;
  }
  return "present";
}

function deriveKnowledge(changeType: string, after: unknown): KnowledgeState {
  if (changeType === "retract") return "confirmed_absent";
  const explicit = readString(after, "knowledgeState") ?? readString(after, "knowledge_state");
  if (changeType === "rollback") {
    if (after == null) return "confirmed_absent";
    if (explicit) return asKnowledge(explicit);
    return "present";
  }
  return asKnowledge(explicit);
}

function readString(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "string" ? raw : null;
}

function readNumber(value: unknown, key: string): number | null {
  if (!value || typeof value !== "object") return null;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function readBool(value: unknown, key: string): boolean | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "boolean" ? raw : undefined;
}

function toIsoTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString();
}

export function factFromLedgerRow(row: LedgerFactRow): VerifiedFact {
  const after = row.afterValue;
  const valueSensitivity = row.valueSensitivity === "redacted" ? "redacted" : "public";
  const publishedAt = toIsoTimestamp(row.publishedAt) ?? row.publishedAt;
  return {
    receiptId: row.receiptId,
    revisionId: row.revisionId,
    changeType: asChangeType(row.changeType),
    entityType: row.entityType,
    entityId: row.entityId,
    fieldName: row.fieldName,
    providerId: row.providerId ?? readString(after, "providerId") ?? null,
    countryCode: extractCountryFromValue(after),
    observedAt: toIsoTimestamp(row.observedAt) ?? publishedAt,
    publishedAt,
    verificationState: asVerification(row.verificationState),
    knowledgeState: deriveKnowledge(row.changeType, after),
    afterValue: after,
    beforeValue: row.beforeValue,
    methodologyVersion: row.methodologyVersion ?? INTELLIGENCE_METHODOLOGY_ID,
    dataRevision: row.dataRevision ?? "unspecified",
    comparable: valueSensitivity === "redacted" ? false : readBool(after, "comparable"),
    amount: valueSensitivity === "redacted" ? null : readNumber(after, "amount"),
    currency: readString(after, "currency"),
    billingUnit: readString(after, "billingUnit"),
    promo: readBool(after, "promo"),
    technologySlug: readString(after, "slug") ?? readString(after, "technologySlug"),
    facilityId: readString(after, "facilityId") ?? (row.entityType === "facility" ? row.entityId : null),
    operatorId: readString(after, "operatorId") ?? readString(after, "operator"),
    validTo: readString(after, "validTo"),
    supersedesReceiptId: row.supersedesReceiptId ?? null,
    valueSensitivity,
  };
}

export function factsFromLedgerRows(rows: LedgerFactRow[]): VerifiedFact[] {
  return rows.map(factFromLedgerRow);
}

export function ledgerFactRowFromJoin(row: Record<string, unknown>): LedgerFactRow {
  return {
    receiptId: String(row.receipt_id),
    revisionId: String(row.revision_id),
    changeType: String(row.change_type),
    entityType: String(row.entity_type),
    entityId: String(row.entity_id),
    fieldName: String(row.field_name),
    providerId: row.provider_id ? String(row.provider_id) : null,
    observedAt: row.observed_at ? String(row.observed_at) : null,
    publishedAt: String(row.published_at),
    verificationState: String(row.verification_state),
    afterValue: row.after_value,
    beforeValue: row.before_value,
    methodologyVersion: row.methodology_version ? String(row.methodology_version) : null,
    dataRevision: row.data_revision ? String(row.data_revision) : null,
    supersedesReceiptId: row.supersedes_receipt_id ? String(row.supersedes_receipt_id) : null,
    valueSensitivity: row.value_sensitivity ? String(row.value_sensitivity) : null,
  };
}
