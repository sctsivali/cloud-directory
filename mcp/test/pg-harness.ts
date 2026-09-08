import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client, Pool } from "../src/pg.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL?.trim() ?? "";

const PG_TEST_LOCK_KEY = 726331;

export async function withMigratedDatabase<T>(
  fn: (client: InstanceType<typeof Client>, pool: InstanceType<typeof Pool>) => Promise<T>
): Promise<T> {
  if (!TEST_DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL not set");
  }
  const lockClient = new Client({ connectionString: TEST_DATABASE_URL });
  await lockClient.connect();
  try {
    await lockClient.query("SELECT pg_advisory_lock($1)", [PG_TEST_LOCK_KEY]);
    const client = new Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query("DROP SCHEMA IF EXISTS public CASCADE");
      await client.query("CREATE SCHEMA public");
      const migrated = spawnSync(
        "python",
        ["scripts/migrate.py", "--database-url", TEST_DATABASE_URL],
        { cwd: repoRoot, encoding: "utf8", env: process.env }
      );
      if (migrated.status !== 0) {
        throw new Error(migrated.stderr || migrated.stdout || "migrate.py failed");
      }
      const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 10 });
      try {
        return await fn(client, pool);
      } finally {
        await pool.end();
      }
    } finally {
      await client.end();
    }
  } finally {
    try {
      await lockClient.query("SELECT pg_advisory_unlock($1)", [PG_TEST_LOCK_KEY]);
    } finally {
      await lockClient.end();
    }
  }
}
