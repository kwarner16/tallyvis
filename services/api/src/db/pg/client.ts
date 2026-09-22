import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { runMigrations } from "./migrate";

/**
 * Phase 1 of production readiness (see
 * docs/decisions/0021-postgres-migration.md) — the network-Postgres
 * counterpart to the retired `../client.ts` (`node:sqlite`). Connects
 * exclusively via `DATABASE_URL`, read from the environment — never a
 * hardcoded host/user/password/database name, and never logged (a
 * connection-string parse failure or connection error is reported by
 * category only; see `describeConnectionError` below).
 *
 * A single process-wide `Pool` (not one client per request) — the same
 * "resolve once, reuse" shape `../client.ts`'s `singleton` used for its
 * one SQLite handle, adapted for a real connection pool. `pg.Pool` already
 * queues/recycles connections safely across concurrent requests within one
 * Node process; see this module's own doc comment in
 * docs/decisions/0021-postgres-migration.md for how that interacts with
 * Vercel's serverless execution model (one process is NOT guaranteed to
 * stay warm across requests) and why the hosted provider's own pooled
 * connection string, not a larger `max`, is the real answer there.
 */

let pool: Pool | undefined;

function resolveConnectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. See .env.example for what to configure — this must be a real Postgres connection string, never hardcoded.",
    );
  }
  return url;
}

function getPool(): Pool {
  if (pool) return pool;
  pool = new Pool({
    connectionString: resolveConnectionString(),
    // Neon/Supabase both terminate TLS with a certificate chain that
    // Node's default trust store already recognizes in normal operation;
    // `rejectUnauthorized: false` is NOT set here — an invalid/expired
    // certificate should fail loudly, not be silently accepted. If a
    // specific provider ever requires a custom CA, that's configured via
    // its own connection-string `sslmode`/`sslrootcert` parameters, not by
    // weakening verification here.
    max: 10,
  });
  // Never let a background connection error crash the process — pg's Pool
  // emits 'error' for problems on idle clients (e.g. the provider closing
  // an idle connection), which Node treats as an unhandled exception if
  // nothing is listening.
  pool.on("error", (err) => {
    console.error("Postgres pool error (idle client):", describeConnectionError(err));
  });
  return pool;
}

/**
 * Applies pending migrations and returns the ready-to-use pool. Call once
 * at process start (mirrors `../client.ts`'s `getDb()` running
 * `runMigrations` inside `open()`) — every query in this module goes
 * through a pool that has already been migrated, so the app can never
 * observe a partially-migrated schema.
 */
export async function getPool_migrated(): Promise<Pool> {
  const p = getPool();
  await runMigrations(p);
  return p;
}

export interface QueryResult<T extends QueryResultRow = QueryResultRow> {
  rows: T[];
  rowCount: number;
}

/** A single query against the pool — acquires a connection, runs it, releases it. Use `withTransaction` instead for multi-statement atomicity. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  const result = await getPool().query<T>(text, params);
  return { rows: result.rows, rowCount: result.rowCount ?? 0 };
}

/**
 * Runs `fn` inside a single BEGIN/COMMIT (or ROLLBACK on throw) against one
 * checked-out client — the Postgres counterpart to `../client.ts`'s
 * callers doing `db.exec("BEGIN")`/`db.exec("COMMIT")`/`db.exec("ROLLBACK")`
 * directly (services/auth.ts, services/googleAuth.ts,
 * services/passwordReset.ts, services/quoteSharing.ts,
 * services/accountDeletion.ts). Those five call sites become
 * `await withTransaction(async (tx) => { ... })`, passing `tx` (a
 * `TransactionClient`) to repository functions instead of the pool
 * directly, so every statement inside the callback runs on the SAME
 * connection — required for BEGIN/COMMIT to mean anything.
 */
export interface TransactionClient {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export async function withTransaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
  const client: PoolClient = await getPool().connect();
  const tx: TransactionClient = {
    query: async (text, params = []) => {
      const result = await client.query(text, params);
      return { rows: result.rows, rowCount: result.rowCount ?? 0 };
    },
  };
  try {
    await client.query("BEGIN");
    const result = await fn(tx);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Postgres error code 23505 (`unique_violation`) — the direct replacement for every `err.message.includes("UNIQUE constraint failed")` check the SQLite code used (services/auth.ts, services/googleAuth.ts). */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

/** Safe-to-log category for a Postgres error — never the connection string, never a query's bound parameter VALUES (which may be customer data), only the error's own code/table/constraint metadata `pg` already separates out. */
export function describeConnectionError(err: unknown): string {
  if (typeof err !== "object" || err === null) return "unknown error";
  const e = err as { code?: string; message?: string };
  return e.code ? `[${e.code}] ${e.message ?? "no message"}` : (e.message ?? "unknown error");
}

/** Test-only: a fresh pool pointed at a separate, disposable database — never the dev/production one. Mirrors `../client.ts`'s `createTestDb()`. See docs/decisions/0021-postgres-migration.md for why tests run against real Postgres rather than an in-memory stand-in. */
export async function createTestPool(testDatabaseUrl: string): Promise<Pool> {
  const testPool = new Pool({ connectionString: testDatabaseUrl, max: 5 });
  await runMigrations(testPool);
  return testPool;
}
