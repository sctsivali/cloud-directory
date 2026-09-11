import { createHash } from "node:crypto";

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function bodyDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function proposalBodyForDigest(
  toolName: string,
  input: Record<string, unknown>
): Record<string, unknown> {
  const { idempotencyKey: _key, actorId: _actor, reviewerId: _reviewer, ...body } = input;
  void _key;
  void _actor;
  void _reviewer;
  return { toolName, ...body };
}
