import { afterAll, beforeAll, beforeEach } from "vitest";
import { createTestDb, resetTestDb, dropTestDb, type TestDb } from "../db/pg/testDb";
import type { Queryable } from "../db/pg/client";

/**
 * Real-Postgres test setup shared by every test file (Part 17 of
 * docs/decisions/0021-postgres-migration.md's mission — no mocked
 * database for repository/service tests). Registers file-level
 * `beforeAll`/`beforeEach`/`afterAll` hooks:
 *
 *   - `beforeAll`: creates one fresh, randomly-named Postgres schema for
 *     this test FILE and runs migrations into it once.
 *   - `beforeEach`: TRUNCATEs every app table before each individual
 *     test — the replacement for the old SQLite `createTestDb()`'s "brand
 *     new `:memory:` database per test" guarantee, including for tests
 *     that reuse a literal fixed email/token across multiple `it()`
 *     blocks in the same file.
 *   - `afterAll`: drops the schema so test runs never accumulate schemas
 *     in the target database.
 *
 * Call once per test file, at the top level (not inside a `describe`):
 *
 *   const getDb = useTestDb();
 *   async function setUp() {
 *     const db = getDb();
 *     const { session } = await signUp(db, { ... });
 *     return { db, session };
 *   }
 */
export function useTestDb(): () => Queryable {
  let testDb: TestDb | undefined;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  beforeEach(async () => {
    if (!testDb) throw new Error("useTestDb(): beforeAll has not run yet.");
    await resetTestDb(testDb);
  });

  afterAll(async () => {
    if (testDb) await dropTestDb(testDb);
  });

  return () => {
    if (!testDb) throw new Error("useTestDb(): beforeAll has not run yet — db accessed too early.");
    return testDb.db;
  };
}
