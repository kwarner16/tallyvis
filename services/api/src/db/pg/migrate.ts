import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

/**
 * Applies every `.sql` file in `db/pg/migrations/` in filename order,
 * tracking what's already been applied in a `schema_migrations` table —
 * the same idempotent, safe-to-call-on-every-process-start shape the
 * retired SQLite-era migration runner already established, adapted for
 * Postgres:
 *
 *   * Each migration file runs inside its own real transaction
 *     (BEGIN/COMMIT/ROLLBACK) with foreign keys enforced throughout —
 *     Postgres has no SQLite-style "PRAGMA foreign_keys is a no-op inside
 *     a transaction" wrinkle, and no `ALTER TABLE ... ALTER COLUMN`
 *     limitation forcing a create/copy/drop/rename dance, so this is
 *     simpler than the SQLite version, not just a port of it.
 *   * A migration that fails rolls back cleanly and throws — the caller
 *     (this module's own `applyPendingMigrations`, and anything that calls
 *     it at process start) must treat that as fatal. Deployment stops.
 *   * Never a destructive auto-sync: this only ever applies the exact SQL
 *     text in a tracked migration file, in order, once each.
 */
export async function runMigrations(pool: Pool): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`,
  );

  const appliedResult = await pool.query<{ name: string }>("SELECT name FROM schema_migrations");
  const applied = new Set(appliedResult.rows.map((row) => row.name));

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");

    const client = await pool.connect();
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
    } finally {
      client.release();
    }
  }
}
