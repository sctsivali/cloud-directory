import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("Node package module type", () => {
  it("declares type module so TypeScript-under-Node is not typeless", () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "web", "package.json"), "utf8")) as {
      type?: string;
    };
    assert.equal(pkg.type, "module");
  });
});
