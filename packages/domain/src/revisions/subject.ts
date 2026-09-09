import type { ProposalSnapshot, PublicationReceipt, RevisionSnapshot } from "./types.ts";

const REDACTED_FIELDS = ["password", "secret", "token", "credential", "private_key"];

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

export function deriveSubject(
  proposal: ProposalSnapshot,
  revision: RevisionSnapshot,
  rollbackOfReceiptId: string | null
): DerivedSubject {
  const body = { ...proposal.body, ...revision.body };
  const entityType = asString(body.subjectType) ?? (proposal.toolName.includes("offering") ? "offering" : "provider");
  const entityId =
    asString(body.subjectId) ??
    asString(body.providerId) ??
    asString(body.offeringId) ??
    asString(body.claimId) ??
    proposal.id;
  const fieldName =
    asString(body.claimType) ??
    (proposal.toolName === "directory.propose_price_observation" ? "price" : "value");
  const afterValue = body.value ?? {
    name: body.name,
    amount: body.amount,
    currency: body.currency,
    city: body.city,
    country: body.country,
  };
  const snapshot = asString(body.snapshotId);
  const evidenceSnapshotIds = Array.isArray(body.evidenceSnapshotIds)
    ? body.evidenceSnapshotIds.filter((row): row is string => typeof row === "string")
    : snapshot
      ? [snapshot]
      : [];
  const changeType: PublicationReceipt["changeType"] = rollbackOfReceiptId
    ? "rollback"
    : proposal.toolName === "directory.propose_retraction"
      ? "retract"
      : "create";
  const providerId = asString(body.providerId) ?? (entityType === "provider" ? entityId : null);
  const sensitive = REDACTED_FIELDS.includes(fieldName);
  const titleEn = `${entityType} ${fieldName} ${changeType}`;
  const titleId = `${entityType} ${fieldName} ${changeType}`;
  return {
    entityType,
    entityId,
    fieldName,
    afterValue,
    evidenceSnapshotIds,
    observedAt: asString(body.observedAt),
    changeType,
    providerId,
    sourceId: snapshot,
    valueSensitivity: sensitive ? "redacted" : "public",
    titleId,
    titleEn,
    summaryId: titleId,
    summaryEn: titleEn,
    href: providerId ? `/provider/${providerId}` : `/revisions/${revision.id}`,
  };
}
