import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../db/migrate";

const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
const MIGRATIONS_DIR = path.join(__dirname, "..", "db", "migrations");

/**
 * Regression coverage for a real incident during this pass: migration
 * 0008 (relaxing `users.password_hash` to nullable, for Google-only
 * accounts) rebuilds the `users` table — SQLite has no
 * `ALTER TABLE ... ALTER COLUMN`. Every other test in this suite runs
 * migrations against a brand-new, empty `:memory:` database, where
 * `users`/`sessions` have zero rows by the time 0008 runs — that setup
 * could never have caught the actual bug: with `PRAGMA foreign_keys = ON`
 * (set by `db/client.ts` on every real connection) and at least one
 * existing `sessions` row referencing `users`, dropping the old `users`
 * table failed outright with "FOREIGN KEY constraint failed". Verified
 * for real against this repo's own populated dev database before this
 * test was written; this test is what makes that verification permanent
 * and automated rather than a one-off manual check.
 */
describe("runMigrations — 0008 users-table rebuild against a POPULATED database", () => {
  it("preserves every existing user and session (and their foreign-key relationship) through the password_hash-nullable rebuild", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");

    // Apply every migration up to (but not including) 0008 — simulating a
    // real database that predates this schema change.
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const preExistingFiles = files.filter((f) => f < "0008");
    expect(preExistingFiles.length).toBeGreaterThan(0);
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
    for (const file of preExistingFiles) {
      db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8"));
      // Mark it applied so the real `runMigrations` call below (which checks
      // this same table) skips re-running it and only applies 0008+.
      db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(file, new Date().toISOString());
    }

    // Seed real-looking pre-existing data: a business, a user with a real
    // (NOT NULL, pre-Google-auth) password hash, and a session referencing
    // that user — exactly the shape that broke without the migrate.ts fix.
    db.exec(
      `INSERT INTO businesses (id, name, email, phone, service_area, default_industry, created_at, public_embed_id)
       VALUES ('biz_1', 'Sparkle Windows', 'owner@sparkle.example', '', '', 'window-cleaning', '2026-01-01T00:00:00.000Z', 'embed_1')`,
    );
    db.exec(
      `INSERT INTO users (id, business_id, email, password_hash, created_at)
       VALUES ('user_1', 'biz_1', 'owner@sparkle.example', 'a-real-bcrypt-hash', '2026-01-01T00:00:00.000Z')`,
    );
    db.exec(
      `INSERT INTO sessions (token_hash, user_id, business_id, expires_at, created_at)
       VALUES ('some_token_hash', 'user_1', 'biz_1', '2030-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    );

    // Now run the FULL migration set (including 0008) via the real runner
    // — this must not throw, and must not lose or orphan anything.
    expect(() => runMigrations(db)).not.toThrow();

    const user = db.prepare("SELECT * FROM users WHERE id = 'user_1'").get() as
      | { id: string; email: string; password_hash: string | null }
      | undefined;
    expect(user).toBeTruthy();
    expect(user!.email).toBe("owner@sparkle.example");
    expect(user!.password_hash).toBe("a-real-bcrypt-hash");

    const session = db.prepare("SELECT * FROM sessions WHERE token_hash = 'some_token_hash'").get() as
      | { user_id: string }
      | undefined;
    expect(session?.user_id).toBe("user_1");

    const violations = db.prepare("PRAGMA foreign_key_check").all();
    expect(violations).toEqual([]);

    db.close();
  });

  it("the resulting schema genuinely allows a NULL password_hash (proving the column is nullable, not just that old rows survived)", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    runMigrations(db);

    db.exec(
      `INSERT INTO businesses (id, name, email, phone, service_area, default_industry, created_at, public_embed_id)
       VALUES ('biz_google', 'Google Only Co', 'owner@google-only.example', '', '', 'window-cleaning', '2026-01-01T00:00:00.000Z', 'embed_google')`,
    );
    expect(() =>
      db
        .prepare(
          `INSERT INTO users (id, business_id, email, password_hash, created_at) VALUES ('user_google', 'biz_google', 'owner@google-only.example', NULL, '2026-01-01T00:00:00.000Z')`,
        )
        .run(),
    ).not.toThrow();

    const user = db.prepare("SELECT password_hash FROM users WHERE id = 'user_google'").get() as {
      password_hash: string | null;
    };
    expect(user.password_hash).toBeNull();

    db.close();
  });
});
