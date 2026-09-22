import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Loads ONLY this package's own `.env.local` (DATABASE_URL/DIRECT_URL —
 * see docs/decisions/0021-postgres-migration.md) into `process.env` before
 * tests run — deliberately NOT apps/app's `.env.local`. An earlier attempt
 * at running these tests loaded apps/app's env file directly and it also
 * carried EMAIL_PROVIDER=resend/RESEND_API_KEY, which made
 * quoteEmail.test.ts fire real Resend API calls against fixture addresses
 * like "jordan@example.com" (rejected by Resend's sandbox restrictions) —
 * exactly the kind of accidental external side effect a test suite must
 * never have. Deliberately not the `dotenv` package: three lines of
 * KEY=VALUE parsing for two known, simple values doesn't need a
 * dependency, and never overwrites a value already present in the real
 * environment (e.g. CI setting DATABASE_URL directly).
 */
function loadOwnEnvLocal(): void {
  const envPath = path.join(__dirname, ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (!match) continue;
    const [, key, value] = match;
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
loadOwnEnvLocal();

export default defineConfig({
  test: {
    environment: "node",
    // Vite's built-in Node-builtin externalization list predates
    // `node:sqlite`, so it tries to bundle it as if it were an npm
    // package. Force it (and anything else under node:) to stay external.
    server: {
      deps: {
        external: [/^node:/],
      },
    },
    // Tests now run against real network Postgres (see
    // docs/decisions/0021-postgres-migration.md) rather than in-memory
    // SQLite — a `beforeAll` schema-create-and-migrate round trip, and
    // individual queries, can occasionally take longer than the 5s
    // default under real network latency/provider load.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
