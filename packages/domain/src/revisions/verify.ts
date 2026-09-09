import { bodyDigestFromValue } from "./digest.ts";
import { verificationReplayAllowed } from "./attempts.ts";
import {
  PUBLICATION_ERROR,
  type CanonicalState,
  type ChangeEvent,
  type PreparedVerification,
  type PublicationReceipt,
  type PublicationStore,
  type VerifyOutcome,
  type VerifyRequest,
} from "./types.ts";

function rejected(
  code: (typeof PUBLICATION_ERROR)[keyof typeof PUBLICATION_ERROR],
  message: string
): VerifyOutcome {
  return { outcome: "rejected", code, message };
}

export function judgeVerification(args: {
  receipt: PublicationReceipt;
  event: ChangeEvent | null;
  canonical: CanonicalState | null;
  plan: PreparedVerification;
}): "match" | "failed" | "uncertain" {
  if (!args.event) return "uncertain";
  if (args.event.id !== args.plan.eventId || args.event.receiptId !== args.receipt.id) return "failed";
  if (!args.canonical) return "uncertain";
  const valueDigest = bodyDigestFromValue(args.receipt.afterValue);
  if (
    args.canonical.valueDigest !== args.plan.expectedValueDigest ||
    args.canonical.dataRevision !== args.plan.expectedDataRevision ||
    valueDigest !== args.plan.expectedValueDigest ||
    args.receipt.dataRevision !== args.plan.expectedDataRevision
  ) {
    return "failed";
  }
  return "match";
}

export async function verifyPublication(
  store: PublicationStore,
  request: VerifyRequest
): Promise<VerifyOutcome> {
  if (
    !request.receiptId ||
    !request.eventId ||
    !request.expectedValueDigest ||
    !request.expectedDataRevision ||
    !request.verifierPrincipal
  ) {
    return rejected(PUBLICATION_ERROR.malformedPayload, "verification request is incomplete");
  }

  const existing = await store.findReceiptById(request.receiptId);
  if (!existing) return rejected(PUBLICATION_ERROR.notFound, "publication receipt not found");
  const proposal = await store.findProposal(existing.proposalId);
  const revision = await store.findRevision(existing.revisionId);
  if (
    request.verifierPrincipal === existing.publisherId ||
    request.verifierPrincipal === proposal?.actorId ||
    request.verifierPrincipal === revision?.actorId
  ) {
    return rejected(
      PUBLICATION_ERROR.selfVerifyForbidden,
      "publisher, proposal author, or revision author cannot verify their own publication"
    );
  }

  const plan: PreparedVerification = {
    receiptId: request.receiptId,
    eventId: request.eventId,
    expectedValueDigest: request.expectedValueDigest,
    expectedDataRevision: request.expectedDataRevision,
    verifierPrincipal: request.verifierPrincipal,
    verifiedAt: new Date().toISOString(),
  };
  const wrote = await store.commitVerification(plan);
  if (wrote.write === "ok") return { outcome: "created", receipt: wrote.receipt };
  if (wrote.write === "replayed") return { outcome: "replayed", receipt: wrote.receipt };
  if (wrote.write === "mismatch") {
    return {
      outcome: "rejected",
      code: PUBLICATION_ERROR.verificationMismatch,
      message: "authoritative readback did not match the published receipt",
      receipt: wrote.receipt,
    };
  }
  if (wrote.write === "rejected") return rejected(wrote.code, wrote.message);
  if (wrote.write === "self_verify") {
    return rejected(
      PUBLICATION_ERROR.selfVerifyForbidden,
      "publisher, proposal author, or revision author cannot verify their own publication"
    );
  }

  const after = await store.findReceiptById(request.receiptId);
  if (after && after.verificationState === "verified") {
    if (verificationReplayAllowed({
      verifiedBy: after.verifiedBy,
      verifierPrincipal: request.verifierPrincipal,
      judgment: "match",
    })) {
      return { outcome: "replayed", receipt: after };
    }
    return rejected(PUBLICATION_ERROR.idempotencyConflict, "verification already belongs to a different principal");
  }
  if (after && (after.verificationState === "failed" || after.verificationState === "uncertain")) {
    return {
      outcome: "rejected",
      code: PUBLICATION_ERROR.verificationMismatch,
      message: "authoritative readback did not match the published receipt",
      receipt: after,
    };
  }
  return {
    outcome: "ambiguous",
    code: "commit_uncertain",
    message: "verification commit was not confirmed; refusing a duplicate mutation",
  };
}
