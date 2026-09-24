import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import { MIGRATION_FILENAMES } from "./migrations";

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

/**
 * Applies every file named in `MIGRATION_FILENAMES` (in order) that isn't
 * already recorded in `schema_migrations`, tracking what's applied so
 * this stays idempotent.
 *
 * DEPLOY-TIME ONLY — never called from `getDb()`/ordinary request
 * handling (see docs/decisions/0021-postgres-migration.md's "Production
 * migration strategy" addendum for why: this reads real files off disk,
 * which a Vercel serverless function's bundle does not contain, causing
 * every database-touching request to fail with `ENOENT` once this was
 * wired into `getDb()`'s lazy-init path). The only real callers are
 * `db/runMigrationsCli.ts` (the `pnpm db:migrate` CLI command, run by a
 * human or a deploy step against a real, filesystem-having machine) and
 * this package's own test harness (`testDb.ts`, run via `vitest`, same
 * filesystem access).
 *
 *   * Each migration file runs inside its own real transaction
 *     (BEGIN/COMMIT/ROLLBACK) with foreign keys enforced throughout —
 *     Postgres has no SQLite-style "PRAGMA foreign_keys is a no-op inside
 *     a transaction" wrinkle, and no `ALTER TABLE ... ALTER COLUMN`
 *     limitation forcing a create/copy/drop/rename dance, so this is
 *     simpler than the SQLite version, not just a port of it.
 *   * A migration that fails rolls back cleanly and throws — the caller
 *     must treat that as fatal and stop the deploy.
 *   * Never a destructive auto-sync: this only ever applies the exact SQL
 *     text in a tracked migration file, in order, once each.
 */
export async function runMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    // Session-level advisory lock, held for this whole function (across
    // every migration file's own transaction below), keyed on
    // (a fixed namespace, this connection's current schema) — so two
    // concurrent invocations targeting the SAME schema (e.g. a deploy
    // step and a human both running `pnpm db:migrate` against production
    // at once) serialize instead of racing, while this package's test
    // harness (testDb.ts), which gives every test FILE its own distinct
    // randomly-named schema, never contends across files: different
    // schema, different lock key. Advisory locks are local to each
    // database (not schema), which is exactly why the schema is part of
    // the key — see docs/decisions/0021-postgres-migration.md's
    // "Production migration strategy" addendum. Released automatically if
    // the connection drops for any reason; explicitly released in
    // `finally` otherwise.
    await client.query("SELECT pg_advisory_lock(hashtext('tallyvis:migrations'), hashtext(current_schema()))");
    try {
      await client.query(
        `CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`,
      );

      const appliedResult = await client.query<{ name: string }>("SELECT name FROM schema_migrations");
      const applied = new Set(appliedResult.rows.map((row) => row.name));

      for (const file of MIGRATION_FILENAMES) {
        if (applied.has(file)) continue;
        const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");

        try {
          await client.query("BEGIN");
          await client.query(sql);
          await client.query("INSERT INTO schema_migrations (name, applied_at) VALUES ($1, $2)", [
            file,
            new Date().toISOString(),
          ]);
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK").catch(() => {});
          throw new Error(`Migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext('tallyvis:migrations'), hashtext(current_schema()))").catch(() => {});
    }
  } finally {
    client.release();
  }
}
