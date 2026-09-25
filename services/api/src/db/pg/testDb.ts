import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { runMigrations } from "./migrate";
import { poolQueryable, type Queryable } from "./client";

/**
 * Real-Postgres test isolation (Part 17 of
 * docs/decisions/0021-postgres-migration.md's mission) — replaces the
 * retired SQLite-era `createTestDb()` (a fresh in-memory SQLite database
 * per call, trivially cheap). A fresh schema-per-`:memory:`-DB equivalent
 * against network Postgres, recreated for every one of ~270 tests, would
 * add a full CREATE SCHEMA + 5-migration-file round trip to every single
 * test — correct, but slow enough to make the suite impractical. Instead:
 *
 *   * One fresh, randomly-named Postgres SCHEMA per TEST FILE
 *     (`createTestDb()`, called once in a `beforeAll`), migrated once.
 *   * `resetTestDb()` TRUNCATEs every app table (one round trip) in a
 *     `beforeEach`, giving each individual test the same "nothing from a
 *     previous test is still here" guarantee the old per-test SQLite
 *     database gave — including for tests that reuse a literal fixed
 *     email/token across multiple `it()` blocks in the same file.
 *   * `dropTestDb()` drops the schema in an `afterAll`, so a test run
 *     never accumulates schemas in the target database over time.
 *
 * Every test file's own tables are fully isolated from every OTHER test
 * file's schema (safe to run test files in parallel) and from the
 * application's own `public` schema (a test run can never touch real
 * dev/production data).
 */
export interface TestDb {
  db: Queryable;
  schema: string;
  /** Internal only — used by resetTestDb/dropTestDb, never passed to repository/service functions. */
  pool: Pool;
}

const APP_TABLES = [
  "benchmark_cases",
  "job_outcomes",
  "quote_share_tokens",
  "auth_identities",
  "password_reset_tokens",
  "billing_charges",
  "subscriptions",
  "quotes",
  "customers",
  "pricing_configurations",
  "sessions",
  "users",
  "businesses",
];

/**
 * Tests connect via `DIRECT_URL` (falling back to `DATABASE_URL` if unset)
 * rather than the pooled `DATABASE_URL` most callers use: schema isolation
 * below sets `search_path` as a connection startup parameter, which a
 * PgBouncer-backed pooled endpoint (Neon's `-pooler` connection string)
 * explicitly rejects ("unsupported startup parameter... Please use
 * unpooled connection" — confirmed against the real error, not assumed).
 * A modest number of direct connections from local/CI test runs is fine;
 * this is exactly what `DIRECT_URL` exists for. See
 * docs/decisions/0021-postgres-migration.md's "Connection management"
 * section.
 */
function requireDatabaseUrl(): string {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DIRECT_URL/DATABASE_URL is not set. Tests run against real Postgres (see docs/decisions/0021-postgres-migration.md) — set it in apps/app/.env.local before running `pnpm test`.",
    );
  }
  return url;
}

export async function createTestDb(): Promise<TestDb> {
  const url = requireDatabaseUrl();
  const schema = `test_${randomBytes(6).toString("hex")}`;

  // A one-off bootstrap connection (default search_path) just to create
  // the schema, before the real per-schema pool below can use it.
  const bootstrap = new Pool({ connectionString: url, max: 1 });
  try {
    await bootstrap.query(`CREATE SCHEMA "${schema}"`);
  } finally {
    await bootstrap.end();
  }

  const pool = new Pool({ connectionString: url, max: 5, options: `-c search_path=${schema}` });
  await runMigrations(pool);

  return { db: poolQueryable(pool), schema, pool };
}

export async function resetTestDb(testDb: TestDb): Promise<void> {
  const tables = APP_TABLES.map((t) => `"${t}"`).join(", ");
  await testDb.db.query(`TRUNCATE TABLE ${tables} CASCADE`);
}

export async function dropTestDb(testDb: TestDb): Promise<void> {
  await testDb.pool.end();
  const url = requireDatabaseUrl();
  const bootstrap = new Pool({ connectionString: url, max: 1 });
  try {
    await bootstrap.query(`DROP SCHEMA "${testDb.schema}" CASCADE`);
  } finally {
    await bootstrap.end();
  }
}
