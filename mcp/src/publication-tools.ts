import { validateToolInput } from "../../packages/contracts/src/mcp.ts";
import { publishRevision } from "../../packages/domain/src/revisions/publish.ts";
import type { PublicationStore, PublishRequest } from "../../packages/domain/src/revisions/types.ts";
import { verifyPublication } from "../../packages/domain/src/revisions/verify.ts";
import { ERROR_CODE, OUTCOME } from "./errors.ts";
import { bindPrincipal, rejectModelIdentity } from "./principal.ts";
import type { MutationResult } from "./types.ts";

export type PublishContext = {
  publication?: PublicationStore | null;
  principalId: string;
  capabilities?: readonly string[];
};

function rejected(code: string, message: string, errors?: string[]) {
  return { ok: false, outcome: OUTCOME.rejected, code, message, errors };
}

export function hasPublishCapability(capabilities: readonly string[] | undefined): boolean {
  return Array.isArray(capabilities) && capabilities.includes("publish");
}

export function requirePublishAuth(capabilities: readonly string[] | undefined) {
  if (!hasPublishCapability(capabilities)) {
    return rejected(ERROR_CODE.capabilityMissing, "missing capability publish");
  }
  return null;
}

export function hasVerifyCapability(capabilities: readonly string[] | undefined): boolean {
  return Array.isArray(capabilities) && capabilities.includes("verify");
}

export function requireVerifyAuth(capabilities: readonly string[] | undefined) {
  if (!hasVerifyCapability(capabilities)) {
    return rejected(ERROR_CODE.capabilityMissing, "missing capability verify");
  }
  return null;
}

function asRecord(input: unknown): Record<string, unknown> | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  return input as Record<string, unknown>;
}

export async function publishApprovedRevision(
  ctx: PublishContext,
  toolName: "directory.publish_revision" | "directory.publish_change",
  input: unknown
): Promise<Record<string, unknown>> {
  const denied = requirePublishAuth(ctx.capabilities);
  if (denied) return denied;
  const identity = rejectModelIdentity(input);
  if (identity) return identity;
  const principal = bindPrincipal(ctx.principalId);
  if (typeof principal !== "string") return principal;
  const contract = validateToolInput(toolName, input);
  if (!contract.ok) {
    return rejected(ERROR_CODE.malformedPayload, "malformed publication payload", contract.errors);
  }
  if (!ctx.publication) {
    return rejected(ERROR_CODE.toolUnavailable, "publication ledger is not configured");
  }
  const record = asRecord(input);
  if (!record) return rejected(ERROR_CODE.malformedPayload, "malformed publication payload");

  let proposalId = typeof record.proposalId === "string" ? record.proposalId : "";
  const revisionId = String(record.expectedRevisionId ?? record.revisionId ?? "");
  if (!proposalId && revisionId) {
    const revision = await ctx.publication.findRevision(revisionId);
    proposalId = revision?.proposalId ?? "";
  }
  const request: PublishRequest = {
    proposalId,
    expectedRevisionId: revisionId,
    expectedBodyDigest: String(record.expectedBodyDigest ?? ""),
    idempotencyKey: String(record.idempotencyKey ?? ""),
    methodologyVersion: String(record.methodologyVersion ?? ""),
    dataRevision: String(record.dataRevision ?? ""),
    publisherPrincipal: principal,
    expectedCanonicalDigest:
      typeof record.expectedCanonicalDigest === "string" ? record.expectedCanonicalDigest : undefined,
    rollbackOfReceiptId: typeof record.rollbackOfReceiptId === "string" ? record.rollbackOfReceiptId : undefined,
  };
  const result = await publishRevision(ctx.publication, request);
  return result as unknown as Record<string, unknown>;
}

export async function verifyPublishedReceipt(
  ctx: PublishContext,
  input: unknown
): Promise<Record<string, unknown>> {
  const denied = requireVerifyAuth(ctx.capabilities);
  if (denied) return denied;
  const identity = rejectModelIdentity(input);
  if (identity) return identity;
  const principal = bindPrincipal(ctx.principalId);
  if (typeof principal !== "string") return principal;
  const contract = validateToolInput("directory.verify_publication", input);
  if (!contract.ok) {
    return rejected(ERROR_CODE.malformedPayload, "malformed verification payload", contract.errors);
  }
  if (!ctx.publication) {
    return rejected(ERROR_CODE.toolUnavailable, "publication ledger is not configured");
  }
  const record = asRecord(input);
  if (!record) return rejected(ERROR_CODE.malformedPayload, "malformed verification payload");
  const result = await verifyPublication(ctx.publication, {
    receiptId: String(record.receiptId ?? ""),
    eventId: String(record.eventId ?? ""),
    expectedValueDigest: String(record.expectedValueDigest ?? ""),
    expectedDataRevision: String(record.expectedDataRevision ?? ""),
    verifierPrincipal: principal,
  });
  return result as unknown as Record<string, unknown>;
}

export type { MutationResult };
