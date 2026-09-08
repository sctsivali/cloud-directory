import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  MODEL_IDENTITY_FIELDS,
  isCanonicalPrincipalId,
  modelSuppliedIdentityFields,
  parsePrincipalId,
  requirePrincipalId,
} from "../src/principal.ts";

const mcpRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("canonical principalId", () => {
  it("accepts a strict lowercase ASCII identifier and rejects case/whitespace variants", () => {
    assert.equal(isCanonicalPrincipalId("worker-a"), true);
    assert.equal(isCanonicalPrincipalId("editor_1"), true);
    assert.equal(isCanonicalPrincipalId("a"), true);

    const rejected = [
      "Worker-A",
      "WORKER-A",
      "worker-A",
      " worker-a",
      "worker-a ",
      " worker-a ",
      "worker a",
      "worker\ta",
      "",
      "1worker",
      "worker/a",
      "wörker",
      "worker-a\n",
    ];
    for (const value of rejected) {
      assert.equal(isCanonicalPrincipalId(value), false, JSON.stringify(value));
      const parsed = parsePrincipalId(value);
      assert.equal(parsed.ok, false, JSON.stringify(value));
    }

    const ok = parsePrincipalId("worker-a");
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.value, "worker-a");
  });

  it("does not fold case or trim whitespace to make an identifier canonical", () => {
    assert.equal(parsePrincipalId("Worker-A").ok, false);
    assert.equal(parsePrincipalId(" worker-a ").ok, false);
    assert.throws(() => requirePrincipalId(undefined), /MCP_PRINCIPAL_ID/);
    assert.throws(() => requirePrincipalId(""), /MCP_PRINCIPAL_ID/);
    assert.throws(() => requirePrincipalId("Editor-1"), /MCP_PRINCIPAL_ID/);
    assert.equal(requirePrincipalId("editor-1"), "editor-1");
  });

  it("treats model-supplied actorId and reviewerId as identity fields", () => {
    assert.deepEqual([...MODEL_IDENTITY_FIELDS], ["actorId", "reviewerId"]);
    assert.deepEqual(modelSuppliedIdentityFields({ proposalId: "p1", reviewerId: "editor-1" }), [
      "reviewerId",
    ]);
    assert.deepEqual(modelSuppliedIdentityFields({ actorId: "other", reviewerId: "x" }), [
      "actorId",
      "reviewerId",
    ]);
    assert.deepEqual(modelSuppliedIdentityFields({ idempotencyKey: "k1" }), []);
  });
});

describe("stdio MCP_PRINCIPAL_ID", () => {
  it("refuses to start without a canonical MCP_PRINCIPAL_ID", () => {
    const env = { ...process.env };
    delete env.MCP_PRINCIPAL_ID;
    const missing = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "src/stdio.ts"],
      { cwd: mcpRoot, encoding: "utf8", env, timeout: 8000 }
    );
    assert.notEqual(missing.status, 0);
    assert.match(`${missing.stderr}\n${missing.stdout}`, /MCP_PRINCIPAL_ID/);

    const invalid = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "src/stdio.ts"],
      {
        cwd: mcpRoot,
        encoding: "utf8",
        env: { ...process.env, MCP_PRINCIPAL_ID: "Worker-A" },
        timeout: 8000,
      }
    );
    assert.notEqual(invalid.status, 0);
    assert.match(`${invalid.stderr}\n${invalid.stdout}`, /MCP_PRINCIPAL_ID|canonical/i);
  });
});
