import { describe, expect, it } from "vitest";
import { runMigrations } from "../db/pg/migrate";
import { createTestDb, dropTestDb } from "../db/pg/testDb";

/**
 * Postgres migration system coverage (Part 17 of
 * docs/decisions/0021-postgres-migration.md's mission). The equivalent
 * SQLite-era test here (`db/migrate.ts`'s regression coverage for the
 * `users.password_hash`-nullable rebuild under `PRAGMA foreign_keys = ON`)
 * no longer applies: that was SQLite's `ALTER TABLE ... ALTER COLUMN`
 * limitation forcing a create/copy/drop/rename dance for an ALREADY
 * historical migration — the Postgres schema
 * (`db/pg/migrations/0001_core.sql`) defines `users.password_hash` as
 * nullable directly, with no incremental rebuild to get wrong. What IS
 * still worth covering for Postgres: idempotency, that every expected
 * table/constraint actually exists, and the one genuine type upgrade
 * (`cancel_at_period_end` as a real boolean) round-trips correctly.
 */
describe("runMigrations (Postgres)", () => {
  it("is idempotent — calling it twice against the same schema applies nothing the second time and does not throw", async () => {
    const testDb = await createTestDb();
    try {
      await expect(runMigrations(testDb.pool)).resolves.not.toThrow();
      const before = await testDb.db.query<{ name: string }>("SELECT name FROM schema_migrations ORDER BY name");
      await expect(runMigrations(testDb.pool)).resolves.not.toThrow();
      const after = await testDb.db.query<{ name: string }>("SELECT name FROM schema_migrations ORDER BY name");
      expect(after.rows).toEqual(before.rows);
    } finally {
      await dropTestDb(testDb);
    }
  });

  it("creates every expected table", async () => {
    const testDb = await createTestDb();
    try {
      const result = await testDb.db.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() ORDER BY table_name`,
      );
      const tables = result.rows.map((r) => r.table_name);
      expect(tables).toEqual(
        [
          "auth_identities",
          "benchmark_cases",
          "billing_charges",
          "businesses",
          "customers",
          "job_outcomes",
          "password_reset_tokens",
          "pricing_configurations",
          "quote_share_tokens",
          "quotes",
          "schema_migrations",
          "sessions",
          "subscriptions",
          "users",
        ].sort(),
      );
    } finally {
      await dropTestDb(testDb);
    }
  });

  it("users.password_hash genuinely allows NULL (a Google-only account has no password credential)", async () => {
    const testDb = await createTestDb();
    try {
      await testDb.db.query(
        `INSERT INTO businesses (id, name, email, phone, service_area, default_industry, created_at, public_embed_id)
         VALUES ('biz_google', 'Google Only Co', 'owner@google-only.example', '', '', 'window-cleaning', '2026-01-01T00:00:00.000Z', 'embed_google')`,
      );
      await expect(
        testDb.db.query(
          `INSERT INTO users (id, business_id, email, password_hash, created_at) VALUES ('user_google', 'biz_google', 'owner@google-only.example', NULL, '2026-01-01T00:00:00.000Z')`,
        ),
      ).resolves.not.toThrow();

      const result = await testDb.db.query<{ password_hash: string | null }>(
        `SELECT password_hash FROM users WHERE id = 'user_google'`,
      );
      expect(result.rows[0]?.password_hash).toBeNull();
    } finally {
      await dropTestDb(testDb);
    }
  });

  it("subscriptions.cancel_at_period_end is a real boolean, defaulting to false", async () => {
    const testDb = await createTestDb();
    try {
      await testDb.db.query(
        `INSERT INTO businesses (id, name, email, phone, service_area, default_industry, created_at, public_embed_id)
         VALUES ('biz_bool', 'Bool Co', 'owner@bool.example', '', '', 'window-cleaning', '2026-01-01T00:00:00.000Z', 'embed_bool')`,
      );
      await testDb.db.query(
        `INSERT INTO subscriptions (id, business_id, plan_id, status, created_at, updated_at)
         VALUES ('sub_bool', 'biz_bool', 'starter', 'trialing', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      );
      const result = await testDb.db.query<{ cancel_at_period_end: boolean }>(
        `SELECT cancel_at_period_end FROM subscriptions WHERE id = 'sub_bool'`,
      );
      expect(result.rows[0]?.cancel_at_period_end).toBe(false);
    } finally {
      await dropTestDb(testDb);
    }
  });

  it("quote_share_tokens allows at most one active (non-revoked) token per quote — the partial unique index", async () => {
    const testDb = await createTestDb();
    try {
      await testDb.db.query(
        `INSERT INTO businesses (id, name, email, phone, service_area, default_industry, created_at, public_embed_id)
         VALUES ('biz_share', 'Share Co', 'owner@share.example', '', '', 'window-cleaning', '2026-01-01T00:00:00.000Z', 'embed_share')`,
      );
      await testDb.db.query(
        `INSERT INTO users (id, business_id, email, password_hash, created_at)
         VALUES ('user_share', 'biz_share', 'owner@share.example', 'hash', '2026-01-01T00:00:00.000Z')`,
      );
      await testDb.db.query(
        `INSERT INTO customers (id, business_id, name, email, created_at, updated_at)
         VALUES ('cust_share', 'biz_share', 'Cust', 'cust@example.com', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      );
      await testDb.db.query(
        `INSERT INTO pricing_configurations (id, business_id, industry, currency, version, effective_at, rules_json)
         VALUES ('pc_share', 'biz_share', 'window-cleaning', 'USD', 1, '2026-01-01T00:00:00.000Z', '{}')`,
      );
      await testDb.db.query(
        `INSERT INTO quotes (id, business_id, customer_id, pricing_config_id, property_type, property_stories, property_address, service_preferences_json, analysis_json, estimate_json, status, created_at, updated_at)
         VALUES ('quote_share', 'biz_share', 'cust_share', 'pc_share', 'single-family', 1, '1 Test St', '{}', '{}', '{}', 'new', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      );

      await testDb.db.query(
        `INSERT INTO quote_share_tokens (id, quote_id, business_id, token_hash, created_at, expires_at, revoked_at)
         VALUES ('token_1', 'quote_share', 'biz_share', 'hash_1', '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z', NULL)`,
      );

      await expect(
        testDb.db.query(
          `INSERT INTO quote_share_tokens (id, quote_id, business_id, token_hash, created_at, expires_at, revoked_at)
           VALUES ('token_2', 'quote_share', 'biz_share', 'hash_2', '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z', NULL)`,
        ),
      ).rejects.toMatchObject({ code: "23505" });

      // Revoking the first, THEN inserting a second active one, is allowed.
      await testDb.db.query(`UPDATE quote_share_tokens SET revoked_at = '2026-01-02T00:00:00.000Z' WHERE id = 'token_1'`);
      await expect(
        testDb.db.query(
          `INSERT INTO quote_share_tokens (id, quote_id, business_id, token_hash, created_at, expires_at, revoked_at)
           VALUES ('token_3', 'quote_share', 'biz_share', 'hash_3', '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z', NULL)`,
        ),
      ).resolves.not.toThrow();
    } finally {
      await dropTestDb(testDb);
    }
  });
});
