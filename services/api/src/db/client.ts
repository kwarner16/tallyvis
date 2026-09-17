import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "./migrate";

// `node:sqlite` has no non-prefixed alias and is new enough that some
// bundlers (Vite's dep pre-transform, and — the reason this matters here —
// Next.js's Turbopack when apps/app imports this package) don't recognize
// the specifier as a Node builtin and try to resolve it as a package.
// `process.getBuiltinModule` is a plain runtime function call, invisible to
// static import analysis, so it sidesteps that entirely.
const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

let singleton: DatabaseSyncType | undefined;

function resolveDatabasePath(): string {
  const configured = process.env.DATABASE_URL;
  if (!configured) return path.join(PACKAGE_ROOT, "data", "tallyvis.dev.db");
  if (configured === ":memory:") return configured;
  return path.isAbsolute(configured) ? configured : path.resolve(PACKAGE_ROOT, configured);
}

function open(dbPath: string): DatabaseSyncType {
  if (dbPath !== ":memory:") mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  runMigrations(db);
  return db;
}

/**
 * The process-wide database handle for the running application (dev or
 * production) — a single SQLite file, resolved from `DATABASE_URL`
 * (relative paths resolve against this package, not the caller's cwd,
 * since apps/app's Next.js process runs from apps/app/). Every read/write
 * of business-owned data ultimately goes through this or `createTestDb()`;
 * nothing outside `services/api` should open its own connection.
 */
export function getDb(): DatabaseSyncType {
  singleton ??= open(resolveDatabasePath());
  return singleton;
}

/**
 * A fresh, isolated in-memory database with migrations applied — for tests
 * only. Never touches the dev/production file, and every call returns a
 * brand-new database so tests can't leak state into one another.
 */
export function createTestDb(): DatabaseSyncType {
  return open(":memory:");
}
