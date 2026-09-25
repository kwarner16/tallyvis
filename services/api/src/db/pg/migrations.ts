/**
 * The canonical, ordered list of migration filenames under `./migrations/`
 * — the single source of truth for both applying migrations
 * (`migrate.ts`, a deploy-time-only operation — see that file's own
 * comment) and verifying the deployed schema is up to date at ordinary
 * request time (`client.ts`'s `assertSchemaUpToDate`) WITHOUT ever
 * touching the filesystem from a request handler.
 *
 * This exists because Vercel's serverless bundling (`@vercel/nft`, driven
 * by static import analysis) has no way to know that `readdirSync`ing a
 * runtime-computed directory needs those `.sql` files included in the
 * deployment — they're plain data files, not imported by any `import`/
 * `require` statement, so they were silently absent from the deployed
 * function, and every request touching the database failed with `ENOENT:
 * no such file or directory, scandir '/var/task/.../migrations'`. See
 * docs/decisions/0021-postgres-migration.md's "Production migration
 * strategy" addendum for the full incident and the architecture this
 * replaced (migrations auto-running from `getDb()` on every request).
 *
 * Whenever a new migration file is added under `./migrations/`, add its
 * filename here too, in the same commit — nothing else discovers it.
 */
export const MIGRATION_FILENAMES: readonly string[] = [
  "0001_core.sql",
  "0002_quote_sharing.sql",
  "0003_job_outcomes.sql",
  "0004_accounts_billing.sql",
  "0005_google_auth.sql",
  "0006_benchmark_cases.sql",
  "0007_google_onboarding.sql",
];
