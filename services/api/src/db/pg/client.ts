import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { runMigrations } from "./migrate";

/**
 * Phase 1 of production readiness (see
 * docs/decisions/0021-postgres-migration.md). The sole database access
 * point for the running application — `node:sqlite` has been fully
 * retired from production code (see the ADR's "Cutover" section for what
 * was removed and when). Connects exclusively via `DATABASE_URL`, read
 * from the environment — never a hardcoded host/user/password/database
 * name, and never logged (a connection error is reported by category
 * only; see `describeConnectionError`).
 */

export interface QueryResult<T extends QueryResultRow = QueryResultRow> {
  rows: T[];
  rowCount: number;
}

/**
 * Everything a repository function needs — satisfied by the process-wide
 * pool (`getDb()`, ordinary calls), a single checked-out transactional
 * client (`db.transaction()`, the five call sites that used to do
 * `db.exec("BEGIN")`/`COMMIT`/`ROLLBACK` by hand against SQLite), and a
 * test's schema-scoped pool (`db/pg/testDb.ts`). Every repository
 * function's first parameter changes from `db: DatabaseSync` to
 * `db: Queryable` — everything else about its shape (still one function
 * per operation, still hand-written parameterized SQL) is unchanged.
 *
 * `transaction()` is a METHOD on `Queryable`, deliberately not a
 * free-floating `withTransaction(fn)` function bound to a hardcoded
 * singleton pool: a transaction must run against the SAME pool the caller's
 * `db` came from. `getDb()`'s app-wide pool and a test's isolated
 * schema-scoped pool (`testDb.ts`) both return their own `Queryable`, each
 * with its own working `transaction()` — a service calling
 * `db.transaction(...)` inside a test correctly opens that transaction
 * against the TEST's pool, never silently against the real application
 * pool. (An earlier version of this file got this wrong — see
 * docs/decisions/0021-postgres-migration.md's "What this ADR does NOT
 * cover yet" history for the bug this replaced: a bare `withTransaction()`
 * always used the app singleton, so a test's own transactional writes
 * were leaking into the real dev/production schema.)
 */
export interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
}

let pool: Pool | undefined;
let migratedPromise: Promise<void> | undefined;

function resolveConnectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. See .env.example for what to configure — this must be a real Postgres connection string, never hardcoded.",
    );
  }
  return url;
}

function getRawPool(): Pool {
  if (pool) return pool;
  pool = new Pool({
    connectionString: resolveConnectionString(),
    // On Vercel, "how many connections total" is really bounded by the
    // hosted provider's own pooled connection string (Neon's `-pooler`
    // hostname, PgBouncer-backed), not by this number — see
    // docs/decisions/0021-postgres-migration.md's "Connection management"
    // section. This just bounds how many connections ONE warm process
    // opens at once.
    max: 10,
  });
  // Never let a background connection error crash the process — pg's Pool
  // emits 'error' for problems on an idle client (e.g. the provider
  // closing an idle connection), which Node treats as an unhandled
  // exception if nothing is listening.
  pool.on("error", (err) => {
    console.error("Postgres pool error (idle client):", describeConnectionError(err));
  });
  return pool;
}

function toQueryResult<T extends QueryResultRow>(result: { rows: T[]; rowCount: number | null }): QueryResult<T> {
  return { rows: result.rows, rowCount: result.rowCount ?? 0 };
}

/** A `Queryable` bound to a single checked-out client — already inside a transaction, so a nested `.transaction()` call just reuses this same client/connection rather than opening a second BEGIN (nothing in this codebase actually nests transactions; this is a safe no-op fallback, not a savepoint implementation). */
function clientQueryable(client: PoolClient): Queryable {
  return {
    query: async <T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) =>
      toQueryResult<T>(await client.query<T>(text, params)),
    transaction: async (fn) => fn(clientQueryable(client)),
  };
}

/** Adapts a raw `pg.Pool` to the `Queryable` shape, including a real `transaction()` that checks out its own dedicated client from THIS pool for the duration of the callback. Used by `getDb()` below and by `testDb.ts`'s schema-scoped test pool. */
export function poolQueryable(pool: Pool): Queryable {
  return {
    query: async <T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) =>
      toQueryResult<T>(await pool.query<T>(text, params)),
    transaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(clientQueryable(client));
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

/**
 * The process-wide database handle — plays the same role the retired
 * SQLite-era `getDb(): DatabaseSync` did. Stays SYNCHRONOUS (existing
 * callers throughout apps/app do `someRepoFn(getDb(), ...)`, not
 * `someRepoFn(await getDb(), ...)`) — every query (and every
 * `.transaction()` call) issued through the returned `Queryable`
 * transparently awaits the one-time migration run first, so no caller can
 * ever observe a partially-migrated schema, but no caller needs its own
 * separate "wait for ready" step either.
 */
export function getDb(): Queryable {
  const p = getRawPool();
  migratedPromise ??= runMigrations(p);
  const wrapped = poolQueryable(p);
  return {
    query: async (text, params = []) => {
      await migratedPromise;
      return wrapped.query(text, params);
    },
    transaction: async (fn) => {
      await migratedPromise;
      return wrapped.transaction(fn);
    },
  };
}

/** Postgres error code 23505 (`unique_violation`) — the direct replacement for every `err.message.includes("UNIQUE constraint failed")` check the SQLite code used (services/auth.ts, services/googleAuth.ts). */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

/** Safe-to-log category for a Postgres error — never the connection string, never a query's bound parameter values (which may be customer data), only the error's own code/message `pg` already separates out. */
export function describeConnectionError(err: unknown): string {
  if (typeof err !== "object" || err === null) return "unknown error";
  const e = err as { code?: string; message?: string };
  return e.code ? `[${e.code}] ${e.message ?? "no message"}` : (e.message ?? "unknown error");
}

/** Test-only escape hatch: closes the pool (e.g. at the very end of a test run). Never called from application code. */
export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
  migratedPromise = undefined;
}
