import type { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

/**
 * Applies every `.sql` file in `db/migrations/` in filename order, tracking
 * what's already been applied in a `schema_migrations` table so this is
 * idempotent — safe to call on every process start, not just once by hand.
 * Deliberately not a full migration framework: this is one initial schema
 * for a SQLite file, not a multi-environment production rollout system yet.
 */
export function runMigrations(db: DatabaseSync): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`,
  );

  const applied = new Set(
    db
      .prepare("SELECT name FROM schema_migrations")
      .all()
      .map((row) => (row as { name: string }).name),
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");

    // `PRAGMA foreign_keys` is a no-op inside a transaction — it can only
    // be toggled between statements, outside any BEGIN/COMMIT — which
    // matters for any migration that rebuilds a table other tables
    // reference (SQLite has no `ALTER TABLE ... ALTER COLUMN`, so relaxing
    // a NOT NULL constraint means create-new/copy/drop-old/rename; with
    // enforcement left on, dropping the referenced table fails outright
    // even though the data itself never becomes inconsistent). Verified
    // against a real, previously-populated database, not just fresh
    // empty test databases, which would never have exposed this: an
    // empty `users` table has no `sessions` rows yet to violate anything.
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(
        file,
        new Date().toISOString(),
      );
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      db.exec("PRAGMA foreign_keys = ON");
      throw new Error(`Migration ${file} failed: ${err instanceof Error ? err.message : err}`);
    }
    db.exec("PRAGMA foreign_keys = ON");

    // Re-enabling enforcement doesn't retroactively validate existing
    // data — explicitly check for anything the migration's own table
    // rebuild(s) may have left inconsistent (e.g. a stray row referencing
    // an id that no longer exists) before trusting this migration
    // succeeded cleanly.
    const violations = db.prepare("PRAGMA foreign_key_check").all();
    if (violations.length > 0) {
      throw new Error(`Migration ${file} left ${violations.length} foreign key violation(s): ${JSON.stringify(violations)}`);
    }
  }
}
