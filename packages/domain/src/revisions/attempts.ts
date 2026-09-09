import type { PublicationAttempt } from "./types.ts";

const ATTEMPT_TRANSITIONS: Record<PublicationAttempt["state"], readonly PublicationAttempt["state"][]> = {
  pending: ["pending", "committed", "uncertain"],
  uncertain: ["uncertain", "committed", "reconciled_committed", "reconciled_absent"],
  committed: ["committed", "reconciled_committed"],
  reconciled_committed: ["reconciled_committed"],
  reconciled_absent: ["reconciled_absent"],
};

export function attemptIdentityEqual(
  existing: Pick<PublicationAttempt, "requestDigest" | "proposalId" | "revisionId" | "publisherId">,
  incoming: Pick<PublicationAttempt, "requestDigest" | "proposalId" | "revisionId" | "publisherId">
): boolean {
  return (
    existing.requestDigest === incoming.requestDigest &&
    existing.proposalId === incoming.proposalId &&
    existing.revisionId === incoming.revisionId &&
    existing.publisherId === incoming.publisherId
  );
}

export function attemptStateAllowed(
  from: PublicationAttempt["state"],
  to: PublicationAttempt["state"]
): boolean {
  return (ATTEMPT_TRANSITIONS[from] ?? []).includes(to);
}

export function applyUncertainAttempt(
  existing: PublicationAttempt | undefined,
  incoming: PublicationAttempt
): { attempt: PublicationAttempt; changed: boolean } {
  if (!existing) {
    return { attempt: { ...incoming, state: "uncertain" }, changed: true };
  }
  if (!attemptIdentityEqual(existing, incoming)) {
    throw new Error("publication attempt identity mismatch");
  }
  if (!attemptStateAllowed(existing.state, "uncertain")) {
    return { attempt: existing, changed: false };
  }
  return {
    attempt: { ...existing, state: "uncertain", updatedAt: incoming.updatedAt },
    changed: existing.state !== "uncertain" || existing.updatedAt !== incoming.updatedAt,
  };
}

const VERIFICATION_TRANSITIONS: Record<string, readonly string[]> = {
  pending: ["pending", "verified", "failed", "uncertain", "rolled_back"],
  verified: ["verified", "rolled_back"],
  failed: ["failed"],
  uncertain: ["uncertain", "verified", "failed"],
  rolled_back: ["rolled_back"],
};

export function verificationStateAllowed(from: string, to: string): boolean {
  return (VERIFICATION_TRANSITIONS[from] ?? []).includes(to);
}
