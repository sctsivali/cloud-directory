import assert from "node:assert/strict";
import { test } from "node:test";
import { getToolDefinition, validateToolInput } from "../../packages/contracts/src/mcp.ts";
import { jsonSchemaToZod } from "../src/zod-schema.ts";

for (const tool of ["directory.publish_revision", "directory.publish_change"]) {
  test(`explicit CAS schema: ${tool} requires nullable precondition in JSON and Zod`, () => {
    const schema = getToolDefinition(tool)!.inputSchema;
    assert.ok(schema.required.includes("expectedCanonicalDigest"));
    assert.deepEqual(schema.properties.expectedCanonicalDigest.type, ["string", "null"]);
    const base = { [tool === "directory.publish_revision" ? "proposalId" : "revisionId"]: "p",
      expectedRevisionId: "r", expectedBodyDigest: "d", idempotencyKey: "key",
      methodologyVersion: "m", dataRevision: "v" };
    const zod = jsonSchemaToZod(schema);
    assert.equal(validateToolInput(tool, base).ok, false);
    assert.equal(zod.safeParse(base).success, false);
    for (const expectedCanonicalDigest of [null, "a".repeat(64)]) {
      const input = { ...base, expectedCanonicalDigest };
      assert.equal(validateToolInput(tool, input).ok, true);
      assert.equal(zod.safeParse(input).success, true);
    }
    for (const expectedCanonicalDigest of [undefined, "", 123, false, {}, []]) {
      const input = { ...base, expectedCanonicalDigest };
      assert.equal(validateToolInput(tool, input).ok, false);
      assert.equal(zod.safeParse(input).success, false);
    }
  });
}
