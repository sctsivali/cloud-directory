import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Client, Pool } from "../src/pg.ts";

const mcpRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("mcp pg dependency isolation", () => {
  it("declares pinned direct pg and @types/pg and imports them normally", () => {
    const pkg = JSON.parse(readFileSync(join(mcpRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    assert.match(String(pkg.dependencies?.pg ?? ""), /^\d+\.\d+\.\d+$/);
    const typesPin = pkg.dependencies?.["@types/pg"] ?? pkg.devDependencies?.["@types/pg"] ?? "";
    assert.match(String(typesPin), /^\d+\.\d+\.\d+$/);

    const source = readFileSync(join(mcpRoot, "src", "pg.ts"), "utf8");
    assert.match(source, /from ["']pg["']/);
    assert.doesNotMatch(source, /createRequire/);
    assert.doesNotMatch(source, /web\/package\.json/);

    const requireFromMcp = createRequire(join(mcpRoot, "package.json"));
    const resolved = requireFromMcp.resolve("pg");
    assert.match(resolved.replaceAll("\\", "/"), /\/mcp\/node_modules\/pg\//);

    assert.equal(typeof Client, "function");
    assert.equal(typeof Pool, "function");
  });

  it("uses a Pool for stdio and dedicated clients for compound writes", () => {
    const stdio = readFileSync(join(mcpRoot, "src", "stdio.ts"), "utf8");
    assert.match(stdio, /new Pool\b/);
    assert.match(stdio, /pool\.end\(/);
    assert.doesNotMatch(stdio, /new Client\b/);

    const store = readFileSync(join(mcpRoot, "src", "pg-store.ts"), "utf8");
    assert.match(store, /\.connect\(/);
    assert.match(store, /\.release\(/);
    assert.match(store, /\bfinally\b/);
    assert.doesNotMatch(store, /\b(mutex|Mutex|AsyncMutex|asyncMutex|withLock)\b/);
  });
});
