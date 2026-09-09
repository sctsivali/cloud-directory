import { bodyDigestFromValue } from "./digest.ts";
import {
  PUBLICATION_ERROR,
  type ChangeEvent,
  type PublicationOutcome,
  type PublicationReceipt,
  type PublicationStore,
} from "./types.ts";

export type RollbackSubject = {
  entityType: string;
  entityId: string;
  fieldName: string;
};

function rejectedOutcome(
  code: (typeof PUBLICATION_ERROR)[keyof typeof PUBLICATION_ERROR],
  message: string
): PublicationOutcome {
  return { outcome: "rejected", code, message };
}

function subjectOf(row: { entityType: string; entityId: string; fieldName: string }): RollbackSubject {
  return { entityType: row.entityType, entityId: row.entityId, fieldName: row.fieldName };
}

function subjectsEqual(a: RollbackSubject, b: RollbackSubject): boolean {
  return a.entityType === b.entityType && a.entityId === b.entityId && a.fieldName === b.fieldName;
}

export function validateRollbackBindings(args: {
  original: PublicationReceipt;
  originalEvent: ChangeEvent | null;
  target: RollbackSubject;
  currentDigest: string | null;
  superseding: PublicationReceipt[];
  ancestors: PublicationReceipt[] | null;
}): PublicationOutcome | null {
  if (!args.originalEvent) {
    return rejectedOutcome(PUBLICATION_ERROR.notFound, "original publication event not found");
  }
  const receiptSubject = subjectOf(args.original);
  const eventSubject = subjectOf(args.originalEvent);
  if (!subjectsEqual(receiptSubject, eventSubject)) {
    return rejectedOutcome(
      PUBLICATION_ERROR.subjectMismatch,
      "original receipt and event subjects differ"
    );
  }
  if (!subjectsEqual(receiptSubject, args.target) || !subjectsEqual(eventSubject, args.target)) {
    return rejectedOutcome(
      PUBLICATION_ERROR.subjectMismatch,
      "rollback target does not match original receipt/event subject"
    );
  }
  if (args.ancestors == null) {
    return rejectedOutcome(PUBLICATION_ERROR.supersessionInvalid, "supersession chain is invalid");
  }
  if (args.superseding.length > 0) {
    return rejectedOutcome(
      PUBLICATION_ERROR.supersessionInvalid,
      "original receipt is already superseded"
    );
  }
  const afterDigest = bodyDigestFromValue(args.original.afterValue);
  if ((args.currentDigest ?? null) !== afterDigest) {
    return rejectedOutcome(
      PUBLICATION_ERROR.staleRollback,
      "canonical state is not the original after-value"
    );
  }
  return null;
}

export async function collectSupersessionAncestors(
  store: Pick<PublicationStore, "findReceiptById">,
  original: PublicationReceipt
): Promise<PublicationReceipt[] | null> {
  const chain: PublicationReceipt[] = [];
  const seen = new Set<string>([original.id]);
  let cursor = original.supersedesReceiptId;
  while (cursor) {
    if (seen.has(cursor)) return null;
    seen.add(cursor);
    const row = await store.findReceiptById(cursor);
    if (!row) return null;
    chain.push(row);
    cursor = row.supersedesReceiptId;
  }
  return chain;
}
