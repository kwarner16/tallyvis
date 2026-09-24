/**
 * `pnpm --filter @tallyvis/api db:migrate` — the one and only place
 * migrations actually run. Deliberately a standalone CLI script, not part
 * of `getDb()`'s request-handling path: see
 * docs/decisions/0021-postgres-migration.md's "Production migration
 * strategy" addendum for the incident (`ENOENT` on every
 * database-touching request in production) that made this an explicit
 * deploy-time step instead.
 *
 * Run this against a database BEFORE deploying code that depends on a new
 * migration — including the very first deploy to a fresh database (a
 * fresh `DATABASE_URL` has no `schema_migrations` table yet, so
 * `getDb()`'s own read-only `assertSchemaUpToDate` check has nothing to
 * pass; this script is what creates that table and everything else in
 * the first place). Connects via `DIRECT_URL` (falling back to
 * `DATABASE_URL`) rather than the pooled connection ordinary application
 * code uses — the same reasoning `db/pg/testDb.ts` already documents:
 * Neon's pooled endpoint rejects the kind of long-lived, DDL-heavy
 * session a migration run is. Safe to re-run any time — idempotent,
 * concurrency-safe via a schema-scoped Postgres advisory lock (see
 * `db/pg/migrate.ts`), and never destructive.
 */
import { Pool } from "pg";
import { runMigrations } from "./pg/migrate";

function requireConnectionString(): string {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DIRECT_URL/DATABASE_URL is not set. Set one in your environment before running db:migrate — see .env.example.",
    );
  }
  return url;
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: requireConnectionString(), max: 1 });
  try {
    console.log("Applying pending migrations…");
    await runMigrations(pool);
    console.log("Migrations applied (or already up to date).");
  } finally {
    await pool.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // Never the connection string — `err` here is a migration/SQL failure
    // or a plain "env var not set" Error, neither of which carries
    // credentials, but this stays deliberately conservative anyway.
    console.error("Migration failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
