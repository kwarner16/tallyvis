import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runMigrations } from "../db/pg/migrate";

/**
 * Regression test for a real production incident (2026-10): a warm
 * serverless process that observed `assertSchemaUpToDate()` reject even
 * ONCE used to stay permanently poisoned for its entire remaining
 * lifetime — every subsequent `getDb().query()`/`.transaction()` call on
 * that same process kept throwing the identical stale "missing
 * migration" error, including from inside the login Server Action, which
 * surfaced it verbatim as a login failure with the customer's credentials
 * never actually checked — even though the real database had already
 * been correctly migrated the whole time. Root cause: `schemaCheckPromise
 * ??= assertSchemaUpToDate(p)` caches a REJECTED promise just as
 * permanently as a resolved one, since `??=` only reassigns when the
 * existing value is null/undefined, not when it's a settled-but-rejected
 * promise. Fixed in `db/pg/client.ts`: only a successful check is cached;
 * a rejected one clears itself so the very next call retries fresh.
 *
 * This exercises the REAL `getDb()`/`assertSchemaUpToDate()` code path —
 * `testDb.ts`'s own per-test-file pool (used by every other test in this
 * package) deliberately bypasses `getDb()` entirely via `poolQueryable()`
 * directly, so it could never have caught this. Runs against a dedicated,
 * throwaway Postgres schema, migrated for real and then deliberately
 * regressed by deleting one migration's own bookkeeping row — never the
 * shared schema any other test file uses.
 */
function requireDirectUrl(): string {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DIRECT_URL/DATABASE_URL is not set — see docs/decisions/0021-postgres-migration.md.");
  }
  return url;
}

function withSearchPath(url: string, schema: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}options=${encodeURIComponent(`-c search_path=${schema}`)}`;
}

describe("getDb() schema-check caching", () => {
  const schema = `test_schemacheck_${randomBytes(6).toString("hex")}`;
  const baseUrl = requireDirectUrl();
  let bootstrapPool: Pool;

  beforeAll(async () => {
    bootstrapPool = new Pool({ connectionString: baseUrl, max: 1 });
    await bootstrapPool.query(`CREATE SCHEMA "${schema}"`);

    const migratingPool = new Pool({ connectionString: withSearchPath(baseUrl, schema), max: 1 });
    await runMigrations(migratingPool); // a real, full migration run — schema_migrations ends up fully populated
    await migratingPool.end();
  });

  afterAll(async () => {
    await bootstrapPool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await bootstrapPool.end();
  });

  it("does not stay poisoned forever after a transient missing-migration failure — the very next call retries and succeeds once the schema catches up, instead of replaying the same cached rejection", async () => {
    const originalDatabaseUrl = process.env.DATABASE_URL;
    vi.resetModules();
    process.env.DATABASE_URL = withSearchPath(baseUrl, schema);
    const { getDb, closePool } = await import("../db/pg/client");

    try {
      // Simulate "the deployed code expects a migration this database
      // doesn't have yet" (exactly the 2026-10 incident) by deleting one
      // real, already-applied migration's own bookkeeping row — not
      // dropping the column/table it added, just the ledger entry
      // `assertSchemaUpToDate` reads.
      const scopedPool = new Pool({ connectionString: withSearchPath(baseUrl, schema), max: 1 });
      await scopedPool.query(`DELETE FROM schema_migrations WHERE name = '0011_trial_eligibility.sql'`);

      // First call on this freshly-imported module ("warm process"): the
      // schema check runs, sees the row missing, and throws.
      await expect(getDb().query("SELECT 1")).rejects.toThrow(/missing migration.*0011_trial_eligibility\.sql/i);

      // Restore the row — the real-world equivalent of someone
      // successfully running `db:migrate` against the live database in
      // the meantime.
      await scopedPool.query(
        `INSERT INTO schema_migrations (name, applied_at) VALUES ('0011_trial_eligibility.sql', $1) ON CONFLICT DO NOTHING`,
        [new Date().toISOString()],
      );
      await scopedPool.end();

      // Second call, same imported module instance (same "warm process")
      // — must actually retry the check, not replay the cached rejection.
      await expect(getDb().query("SELECT 1")).resolves.toBeDefined();
    } finally {
      await closePool();
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });
});
