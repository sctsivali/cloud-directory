import { canonicalJson, sha256Hex } from "../scoring/hash.ts";
import type { ReviewSnapshot } from "./types.ts";

export function bodyDigestFromValue(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

export function approvalDigest(review: ReviewSnapshot): string {
  return bodyDigestFromValue({
    approvalId: review.id,
    reviewerId: review.reviewerId,
    decision: review.decision,
    boundRevisionId: review.boundRevisionId,
    boundBodyDigest: review.boundBodyDigest,
    createdAt: review.createdAt,
  });
}

export function publicationRequestDigest(input: {
  proposalId: string;
  expectedRevisionId: string;
  expectedBodyDigest: string;
  idempotencyKey: string;
  methodologyVersion: string;
  dataRevision: string;
  publisherPrincipal: string;
  expectedCanonicalDigest: string | null;
  rollbackOfReceiptId?: string | null;
}): string {
  return bodyDigestFromValue({
    proposalId: input.proposalId,
    expectedRevisionId: input.expectedRevisionId,
    expectedBodyDigest: input.expectedBodyDigest,
    methodologyVersion: input.methodologyVersion,
    dataRevision: input.dataRevision,
    publisherPrincipal: input.publisherPrincipal,
    expectedCanonicalDigest: input.expectedCanonicalDigest,
    rollbackOfReceiptId: input.rollbackOfReceiptId ?? null,
  });
}

export function newLedgerId(prefix: string): string {
  const rand = Math.random().toString(16).slice(2);
  const time = Date.now().toString(16);
  return `${prefix}_${time}${rand}`.slice(0, 64);
}
