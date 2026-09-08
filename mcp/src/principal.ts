import { ERROR_CODE, OUTCOME } from "./errors.ts";
import type { RejectedOutcome } from "./types.ts";

export const PRINCIPAL_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

export const MODEL_IDENTITY_FIELDS = ["actorId", "reviewerId"] as const;

export type PrincipalParseResult =
  | { ok: true; value: string }
  | { ok: false; message: string };

export function isCanonicalPrincipalId(value: unknown): value is string {
  return typeof value === "string" && PRINCIPAL_ID_PATTERN.test(value);
}

export function parsePrincipalId(raw: unknown): PrincipalParseResult {
  if (!isCanonicalPrincipalId(raw)) {
    return {
      ok: false,
      message: "principalId must be a canonical lowercase ASCII identifier",
    };
  }
  return { ok: true, value: raw };
}

export function requirePrincipalId(raw: string | undefined): string {
  const parsed = parsePrincipalId(raw);
  if (!parsed.ok) {
    throw new Error(
      "MCP_PRINCIPAL_ID must be a canonical lowercase ASCII identifier"
    );
  }
  return parsed.value;
}

export function modelSuppliedIdentityFields(input: unknown): string[] {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return [];
  }
  const record = input as Record<string, unknown>;
  return MODEL_IDENTITY_FIELDS.filter((field) => Object.hasOwn(record, field));
}

export function rejectModelIdentity(input: unknown): RejectedOutcome | null {
  const fields = modelSuppliedIdentityFields(input);
  if (!fields.length) return null;
  return {
    outcome: OUTCOME.rejected,
    code: ERROR_CODE.malformedPayload,
    message: "model-supplied identity fields are rejected",
    errors: fields.map((field) => `forbidden field: ${field}`),
  };
}

export function bindPrincipal(principalId: string): RejectedOutcome | string {
  const parsed = parsePrincipalId(principalId);
  if (!parsed.ok) {
    return {
      outcome: OUTCOME.rejected,
      code: ERROR_CODE.invalidPrincipal,
      message: parsed.message,
    };
  }
  return parsed.value;
}
