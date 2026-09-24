# 0021 — Postgres migration (Phase 1 of production readiness)

**Status:** Accepted — repository/service layer ported, `node:sqlite` fully retired from production code, full canonical test suite (395 tests) passing against real Postgres. Deployment to Vercel and provisioning a production (as opposed to development) database are separate, not-yet-started steps — see "What remains" at the end of this ADR.

## Context

Tallyvis's entire persistence layer (`services/api`) is `node:sqlite` — a
single local file (`services/api/data/tallyvis.dev.db`), one process-wide
synchronous `DatabaseSync` handle (`db/client.ts`'s `getDb()` singleton),
with hand-rolled migrations (`db/migrate.ts`) tracked in a
`schema_migrations` table. This was the correct choice for local
development and for every phase through V1 feature-freeze (`5cc1626`) —
zero external dependencies, zero setup friction, genuinely synchronous
(simpler repository code, no `async`/`await` needed anywhere in
`repositories/*.ts`).

It is not viable for a Vercel deployment: a local SQLite file has no
persistent filesystem to live on across serverless invocations, and
`node:sqlite`'s synchronous API has no network-database equivalent.
Vercel's own guidance, and this migration's own mandate, is a real network
Postgres database.

This phase is infrastructure work — preserving existing behavior, not
redesigning it. No product feature changed. No pricing, AI, or
authentication *semantics* changed (see "Deliberate type upgrades" below
for the two narrow, behavior-preserving exceptions).

## Database inventory (Part 2 of the mission)

Every file with real `node:sqlite` access, found by searching the whole
monorepo for the string `node:sqlite`:

- `services/api/src/db/client.ts` — the singleton `DatabaseSync` handle.
- `services/api/src/db/migrate.ts` — the migration runner.
- `services/api/src/auth/session.ts` — session token validate/create/revoke.
- 12 files under `services/api/src/repositories/`: `accountDeletion.ts`,
  `authIdentities.ts`, `billingCharges.ts`, `businesses.ts`,
  `customers.ts`, `jobOutcomes.ts`, `passwordResetTokens.ts`,
  `pricingConfigurations.ts`, `quotes.ts`, `quoteShareTokens.ts`,
  `subscriptions.ts`, `users.ts` — the only files that write raw SQL,
  matching CLAUDE.md's module-boundary rule.
- 15 files under `services/api/src/services/` that call into those
  repositories (`accountDeletion.ts`, `aiAnalysis.ts`, `auth.ts`,
  `billingWebhooks.ts`, `business.ts`, `customers.ts`, `googleAuth.ts`,
  `jobOutcomes.ts`, `passwordReset.ts`, `pricing.ts`, `quoteEmail.ts`,
  `quotes.ts`, `quoteSharing.ts`, `subscriptions.ts`, and the auth service).
- `services/api/src/__tests__/migrations.test.ts` and
  `services/api/vitest.config.ts` — test bootstrap.
- Two files in `apps/app` (`middleware.ts`, `lib/quoteActions.ts`)
  reference `node:sqlite` only in a *comment* explaining why they must
  never import `@tallyvis/api` from a client/edge context — neither
  actually imports it. Confirms CLAUDE.md's existing module-boundary rule
  ("apps/app must never reach past `services/api`'s `index.ts`") already
  holds today, with zero exceptions to fix.

No other package touches the database — `packages/pricing` and
`services/ai` are, as CLAUDE.md requires, entirely DB-free.

### SQLite-specific assumptions discovered (Part 2/9)

Searched specifically for: `INSERT OR IGNORE`/`INSERT OR REPLACE`,
`last_insert_rowid`, `PRAGMA`, SQLite date/JSON functions
(`datetime()`/`julianday()`/`strftime()`/`json_extract()`/`json_each()`),
`randomblob`, and boolean-as-integer columns.

- **No `INSERT OR IGNORE`/`OR REPLACE`, no `last_insert_rowid`.** Every id
  is an app-generated `prefix_<uuid>` string (`db/ids.ts`'s `makeId()`),
  never a SQLite `rowid`/`AUTOINCREMENT`. This is the single biggest
  reason the port is low-risk: nothing depends on SQLite's identity
  semantics.
- **`PRAGMA foreign_keys`** appears only in `db/client.ts` (turn on once
  per connection) and `db/migrate.ts` (toggled off/on around each
  migration file, because SQLite can't otherwise rebuild a table other
  tables reference). Postgres enforces foreign keys unconditionally inside
  a transaction with no such limitation — this entire dance simply
  disappears in the Postgres migration runner (`db/pg/migrate.ts`).
- **No SQL-side date/JSON functions anywhere.** Every timestamp is
  generated in JS (`new Date().toISOString()`) and compared in JS
  (`new Date(x).getTime()`); every JSON column is opaque TEXT, always
  round-tripped through `JSON.stringify`/`JSON.parse` in JS, never queried
  into via SQL. This matters directly for the schema decisions below.
- **One `randomblob(12)` call**, in migration `0004`'s one-time backfill of
  `businesses.public_embed_id` for rows that predated that column. New
  businesses have always gotten their embed id generated in JS
  (`repositories/businesses.ts`'s `generatePublicEmbedId()`,
  `crypto.randomBytes`) — the SQL-level backfill was only ever needed to
  retrofit pre-existing rows. A fresh Postgres database has no such rows,
  so this backfill has no Postgres equivalent to write.
- **Exactly one boolean-as-integer column**:
  `subscriptions.cancel_at_period_end INTEGER NOT NULL DEFAULT 0`,
  converted in exactly one file (`repositories/subscriptions.ts`, via
  `Boolean(row.cancel_at_period_end)` on read and `? 1 : 0` on write) —
  SQLite has no native boolean type; Postgres does.
- **Three SQLite-specific error-string matches**:
  `services/auth.ts` and `services/googleAuth.ts` (twice) each catch a
  thrown `Error` and check `err.message.includes("UNIQUE constraint
  failed")` to detect a unique-constraint race. Postgres raises a
  structured error with `code: '23505'` instead — `db/pg/client.ts`
  exports `isUniqueViolation(err)` as the direct, one-line replacement for
  all three call sites (not yet wired in — see below).
- **Manual transactions in exactly six places**: `db/migrate.ts` and five
  service functions (`services/auth.ts`'s `signUp`,
  `services/googleAuth.ts`'s `createAccountFromGoogle`,
  `services/passwordReset.ts`'s `resetPassword`,
  `services/quoteSharing.ts`'s `generateShareLink`,
  `services/accountDeletion.ts`'s `deleteAccount`) call
  `db.exec("BEGIN")`/`db.exec("COMMIT")`/`db.exec("ROLLBACK")` directly.
  `db/pg/client.ts`'s `withTransaction()` is the direct replacement — see
  "Repository-layer port" below.
- **No in-memory query caching or connection-level session state** beyond
  the four already-self-documented, already-"best-effort/single-process"
  module-level `Map`/`Set` instances covered under Part 22 below.

## Documented current schema (Part 3)

Reconstructed from all 8 SQLite migration files in
`services/api/src/db/migrations/` (`0001`–`0008`), which are the sole
authority — not any repository's `interface Row` (some of those predate a
later `ALTER TABLE` and would under-report columns).

**businesses** — `id` (PK), `name`, `email`, `phone` (default `''`),
`service_area` (default `''`), `default_industry` (default
`'window-cleaning'`), `created_at`, `public_embed_id` (unique, nullable in
SQLite only for historical backfill — always set by the app for new rows),
`logo_url`, `brand_color`, `embed_last_seen_at`.

**users** — `id` (PK), `business_id` (FK → businesses), `email` (unique),
`password_hash` (nullable since ADR 0019 — a Google-only account has
none), `created_at`. Index: `business_id`.

**sessions** — `token_hash` (PK — the SHA-256 hash of the bearer token,
never the raw token), `user_id` (FK), `business_id` (FK), `expires_at`,
`created_at`. Index: `user_id`.

**pricing_configurations** — `id` (PK), `business_id` (FK), `industry`,
`currency`, `version`, `effective_at`, `rules_json`. Index: `business_id`.

**customers** — `id` (PK), `business_id` (FK), `name`, `email`, `phone`
(nullable), `address` (nullable — see "service address" below), `created_at`,
`updated_at`. Indexes: `business_id`, `(business_id, email)`.

**quotes** — `id` (PK), `business_id` (FK), `customer_id` (FK),
`pricing_config_id` (FK), `property_type`, `property_stories`,
`property_address` (nullable), `service_preferences_json`, `notes`
(default `''`), `photos_json` (default `'[]'`), `analysis_json`,
`estimate_json`, `status`, `created_at`, `updated_at`, `first_viewed_at`,
`last_viewed_at`, `accepted_at`, `declined_at`, `changes_requested_at`,
`customer_request_note`, `ai_observation_json`, `email_sent_at`,
`email_delivery_status`, `email_provider_message_id`. Indexes:
`business_id`, `customer_id`.

**quote_share_tokens** — `id` (PK), `quote_id` (FK), `business_id` (FK),
`token_hash` (unique), `created_at`, `expires_at`, `revoked_at`
(nullable). Indexes: `quote_id`, `business_id`, plus a **partial unique
index** `(quote_id) WHERE revoked_at IS NULL` — at most one active token
per quote.

**job_outcomes** — `id` (PK), `quote_id` (FK, unique — one row per quote),
`business_id` (FK), `status` (default `'in_progress'`),
`actual_started_at`, `actual_completed_at`, `actual_labor_minutes`,
`actual_window_count`, `actual_screen_count`, `actual_story_count`,
`actual_price`, `actual_difficulty`, `notes` (default `''`), `created_at`,
`updated_at`. Indexes: `business_id`, `quote_id`.

**password_reset_tokens** — `id` (PK), `user_id` (FK), `token_hash`
(unique), `created_at`, `expires_at`, `used_at` (nullable — single-use,
set rather than deleted so a replay is detectable). Index: `user_id`.

**subscriptions** — `id` (PK), `business_id` (FK, unique — one row per
business), `plan_id`, `status`, `trial_started_at`, `trial_ends_at`,
`current_period_start`, `current_period_end`, `billing_customer_id`,
`provider_subscription_id`, `provider_checkout_session_id`, `canceled_at`,
`created_at`, `updated_at`, `last_webhook_event_id`,
`last_webhook_event_created_at`, `cancel_at_period_end` (boolean,
default false), `cancel_at`. Index: `business_id`.

**billing_charges** — `id` (PK), `business_id` (FK), `kind`, `status`,
`amount_cents`, `currency`, `provider_charge_id` (nullable), `created_at`,
`updated_at`. Index: `business_id`. **No uniqueness constraint** — see
"Invariants" below.

**auth_identities** — `id` (PK), `user_id` (FK), `provider`,
`provider_account_id`, `email` (denormalized display-only snapshot,
NEVER used for lookup), `created_at`. **Unique index on
`(provider, provider_account_id)`** — the actual identity key. Index:
`user_id`.

Application-level invariants not represented in SQL: `customers.address`
is a schema placeholder never written to by any code path today (see ADR
0020); `quotes.property_address` is required by the application for every
NEW quote (ADR 0020) but the column itself stays nullable (see "Service
address" below); email uniqueness in `users` is case-normalized in JS
(`.trim().toLowerCase()`) before every write/lookup, not by a database
constraint — preserved as-is rather than introducing a new
`citext`-based DB-level constraint, which would be a behavior change
Phase 1 doesn't need.

## Production invariants (Part 4)

**Tenancy.** Every business-owned table carries `business_id`, and (per
CLAUDE.md's existing rule, unchanged by this migration) every repository
query scopes its `WHERE` clause by it explicitly — confirmed by reading
every repository file, not assumed. This migration doesn't add a single
new invariant here; it preserves the existing one and Part 11 below plans
new integration tests that exercise it directly against Postgres (not just
against the SQLite test suite that already covers it).

**Auth.** `users.email` unique, `auth_identities(provider,
provider_account_id)` unique, `sessions.token_hash` unique (it's the
primary key), `password_reset_tokens.token_hash` unique. All four
translate to Postgres unchanged — SQLite `UNIQUE`/`PRIMARY KEY` and
Postgres `UNIQUE`/`PRIMARY KEY` have identical semantics for these
single-column cases.

**Quote sharing.** "One active share token per quote" — enforced today by
a SQLite **partial unique index** (`WHERE revoked_at IS NULL`). Postgres
supports partial unique indexes natively (`CREATE UNIQUE INDEX ... WHERE
...`), so `db/pg/migrations/0002_quote_sharing.sql` is a direct,
unmodified translation — this is not weakened, widened, or re-implemented
at the application layer.

**Billing.** `subscriptions.business_id` unique (one row per business) —
direct translation. Stripe webhook idempotency
(`last_webhook_event_id`)/out-of-order protection
(`last_webhook_event_created_at`)/scheduled cancellation
(`cancel_at_period_end`/`cancel_at`) are all plain columns with no
SQLite-specific behavior — direct translation, with the one boolean
type upgrade noted above.

**The `billing_charges UNIQUE(business_id, kind)` question.** Investigated
against the actual repository code, not assumed: `getBillingChargeByKind`
in `repositories/billingCharges.ts` reads with `ORDER BY created_at DESC
LIMIT 1` — meaning the application was **already written to expect
multiple rows per `(business_id, kind)` over time** and resolve "the
current one" by recency, not by uniqueness (e.g. an abandoned `pending`
charge followed by a fresh one). **Conclusion: do NOT add this
constraint.** Adding it would conflict with already-shipped, tested
behavior, not protect an invariant that actually exists. Documented
directly in `db/pg/migrations/0004_accounts_billing.sql`'s own comment so
this reasoning survives independent of this ADR.

**Service address.** Every quote created from ADR 0020 onward has a
non-empty, validated `property_address`, enforced at the application layer
(`services/quotes.ts`'s `persistPricedQuote`) — unchanged by this
migration. The column stays **nullable** in Postgres too, matching ADR
0020's own reasoning: a fresh Postgres database has no legacy rows to
protect, but the enforcement strategy (application-layer, not
database-level `NOT NULL`) stays consistent between SQLite and Postgres
rather than diverging now only to converge again later. Revisit a `NOT
NULL` constraint once real production data volume makes a database-level
backstop worth the migration cost — not before.

## Chosen architecture (Part 5)

**`pg` (node-postgres) + the existing hand-rolled repository layer, kept
as repository functions that build parameterized SQL strings — no ORM.**

Why, evaluated against the existing architecture rather than picked for
its own sake:

- The current repository layer is already exactly this shape — one
  function per operation, explicit `SELECT`/`INSERT`/`UPDATE` with `?`
  placeholders, hand-written row-to-domain-object mapping. Every
  repository file inventoried above is small (20-150 lines), readable, and
  already the "smallest architectural change that fits" this codebase.
  Introducing an ORM (Prisma, Drizzle, Kysely) would mean re-deriving a
  schema definition language, a second source of truth for the shape
  CLAUDE.md already assigns to `repositories/*.ts`, and a bigger,
  riskier diff for a phase explicitly scoped as "infrastructure work, not
  a redesign."
- `pg` is the standard, most widely-supported Postgres driver for Node —
  works identically against Neon, Supabase, RDS, or a local Postgres
  install, with zero provider-specific API surface. This directly serves
  Part 6's "avoid two divergent production data implementations" and
  Part 7's "use standard Postgres connectivity where practical, don't bind
  unnecessarily to a proprietary provider API."
- Parameterized queries (`$1, $2, ...` instead of SQLite's `?, ?, ...`)
  are the only syntactic change needed at most call sites — safe from SQL
  injection exactly as today, no new escaping/quoting logic to write.
- Transactions: `pg.Pool`'s `connect()` → single `PoolClient` →
  `BEGIN`/queries/`COMMIT`-or-`ROLLBACK` → `release()` is the standard,
  well-documented pattern, wrapped once in `db/pg/client.ts`'s
  `withTransaction()` so the five call sites that currently do this by
  hand against SQLite become one-line changes, not five bespoke
  implementations.
- Testability: real integration tests against a real (disposable) Postgres
  database, not a mocked driver — see Part 17/"Testing strategy" below.

A query-builder (Kysely) was considered and rejected for the same reason
an ORM was: it would improve compile-time SQL safety, but at the cost of
rewriting every one of the ~90 hand-written queries in a new DSL for a
phase whose mandate is "preserve existing behavior," not improve on it.
Worth revisiting later, on its own merits, once this migration is stable
in production — not bundled into it.

## Provider compatibility (Part 7 preview — no account created yet)

`pg` connects to any standard Postgres server over the wire protocol —
Neon, Supabase Postgres, RDS, or a local install are all interchangeable
from the application's point of view, differing only in the connection
string and (for Neon/Supabase) whether a pooled or direct URL is used (see
"Connection management" below). No provider-specific SDK is imported
anywhere in `db/pg/`. See the STOP-point message that follows this report
for the concrete recommendation and exact next steps — not included in
this ADR since it's a decision for you to act on, not a fact about the
codebase.

## Migration system (Part 8)

`services/api/src/db/pg/migrate.ts`'s `runMigrations(pool)`: creates
`schema_migrations(name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)` if
absent, reads which migration filenames are already recorded, and applies
every `.sql` file in `db/pg/migrations/` (sorted by filename, so
`0001_core.sql` before `0002_quote_sharing.sql`, etc.) that isn't yet
recorded — each inside its own real transaction, recording the filename in
the same transaction so a crash mid-migration can never leave a
half-applied, half-recorded state. A failure throws with the specific
filename and underlying error, stopping whatever called it. (This section
originally proposed calling this "on every process start," mirroring the
SQLite version's design — that turned out to be unsafe on Vercel and was
reverted; see "Production migration strategy" below for the incident and
the actual final design: migrations are deploy-time-only, and the app's
own startup path only ever verifies the schema, never applies to it.)

Five consolidated migration files
(`0001_core.sql`/`0002_quote_sharing.sql`/`0003_job_outcomes.sql`/
`0004_accounts_billing.sql`/`0005_google_auth.sql`) represent the CURRENT
final schema shape directly, rather than mechanically replaying all 8
historical SQLite `ALTER TABLE` steps — there is no existing Postgres data
to migrate incrementally through that history (see "Data migration
strategy" below: production starts from a clean Postgres database). Each
file's header comment cross-references the ADR(s) that originally
introduced that piece of schema, so the historical "why" isn't lost.

## Connection management (Part 18 preview)

`db/pg/client.ts` holds a single process-wide `pg.Pool` (mirroring the
SQLite version's single process-wide `DatabaseSync` handle), `max: 10`.
On Vercel, a serverless function invocation does not guarantee the same
process stays warm across requests, so **the pool's own `max` is not what
bounds total connections against the database** — the hosted provider's
own connection pooler (Neon's pooled connection string, PgBouncer-backed;
Supabase's equivalent "Transaction" pooler mode) is what actually protects
Postgres from "N concurrent serverless invocations × `max` connections
each" exhausting it. This is why Part 7's provider recommendation will
matter for the exact connection string shape (a `-pooler` hostname
suffix, or an explicit pooler port) — not a decision this ADR makes
unilaterally, since it depends on which provider you create.

Local/test connections use a plain, unpooled `DATABASE_URL` pointed at
whatever Postgres is running locally — the same driver code path,
no branching logic for "am I local or production," which is the direct
answer to Part 6's "avoid two divergent production data implementations."

## Cutover (completed once a real `DATABASE_URL`/`DIRECT_URL` existed)

Everything below was written and verified against a real, reachable
Postgres database — none of it was written blind.

- **Repository layer**: all 12 repository files converted from synchronous
  `node:sqlite` calls to `async`/`await` `pg` calls through the `Queryable`
  interface — `?` placeholders became `$1, $2, ...`, `.get()`/`.all()`
  became `await db.query(...)` + `.rows[0]`/`.rows`, `.changes` became
  `.rowCount`. `repositories/subscriptions.ts` additionally switched
  `cancel_at_period_end` from `number` (0/1) to a real `boolean`, per the
  ADR's own "deliberate type upgrades" section above.
- **Service layer**: all 15 service files converted the same way. The five
  manual-transaction call sites (`services/auth.ts`'s `signUp`,
  `services/googleAuth.ts`'s `createAccountFromGoogle`,
  `services/passwordReset.ts`'s `resetPassword`,
  `services/quoteSharing.ts`'s `generateShareLink`,
  `services/accountDeletion.ts`'s `deleteAccount`) now call
  `db.transaction(async (tx) => { ... })` instead of hand-rolled
  `BEGIN`/`COMMIT`/`ROLLBACK`. The three `"UNIQUE constraint failed"`
  string-match sites (`services/auth.ts`, `services/googleAuth.ts` ×2) now
  use `isUniqueViolation(err)` (Postgres's `23505` code) instead.
- **A real architecture bug found and fixed during this cutover** (not
  present in the design, only surfaced once real async gaps existed):
  `db/pg/client.ts`'s first draft had a free-floating `withTransaction(fn)`
  function bound to the app's own singleton pool — meaning a transaction
  opened from *test* code (with its own isolated schema-scoped pool) would
  silently write into the real application schema instead. Fixed by making
  `transaction()` a method ON a `Queryable` (`poolQueryable(pool)`), so it
  always operates against whichever pool the caller's `db` actually came
  from. Caught by `pricing.test.ts`/`business.test.ts`/`customers.test.ts`
  writing real rows into the dev database's `public` schema on the very
  first cutover test run; those leaked rows were identified and deleted
  before continuing.
- **A second real concurrency bug found and fixed**: `services/subscriptions.ts`'s
  `createCheckoutSessionForPlan` and `createInstallationCheckoutSession`
  both called their in-memory `inFlightCheckouts` double-submit guard
  (`beginCheckout()`) *after* an `await getBusinessById(...)`. Under the
  old synchronous SQLite code this was safe — nothing could interleave
  before the guard registered. Under real async Postgres, this opened a
  genuine race window where two near-simultaneous calls could both pass
  the (not-yet-registered) guard before either finished its own lookup,
  undermining the exact double-Stripe-Checkout-session protection this
  guard exists for (see that guard's own module comment on
  `inFlightCheckouts`, and Part 13 of the mission on concurrent billing
  correctness). Fixed by moving `beginCheckout()` to before the first
  `await` in both functions — found via a full-suite test run (this
  specific interleaving only manifested under the concurrent load of many
  test files hitting Postgres at once, not when the affected test file ran
  alone), not by static reasoning alone.
- **Tests**: all ~20 test files ported to `services/api/src/__tests__/testHarness.ts`'s
  `useTestDb()` — one fresh, randomly-named Postgres schema per test FILE
  (`beforeAll`), `TRUNCATE`d before every individual test (`beforeEach`,
  restoring the same "nothing from a previous test survives" guarantee the
  old per-test in-memory SQLite database gave), dropped afterward
  (`afterAll`). `migrations.test.ts` was rewritten from scratch — its
  SQLite-era regression coverage (the `users.password_hash`-nullable
  `ALTER TABLE` rebuild under populated data) no longer has a Postgres
  equivalent to test, since the consolidated schema defines that column as
  nullable directly; replaced with idempotency, full-table-existence, the
  boolean-column type, and partial-unique-index coverage instead.
  `stripeProvider.test.ts` and `googleOAuth.test.ts` needed no changes —
  neither touches the database. Final count: 32 test files, 395 tests (net
  +3 over the pre-migration 392, entirely from `migrations.test.ts` gaining
  3 more tests than the file it replaced), all passing against real
  Postgres.
- **`apps/app` callers**: every Server Component/Action calling into
  `@tallyvis/api` updated to `await` the now-async calls. `tsc` caught most
  of these directly; a handful were missed by the type checker because
  returning an un-awaited promise as an async function's own return value,
  or discarding an un-awaited promise's result entirely, doesn't produce a
  type error — found instead by grepping every known async API function
  name (including two that were only reachable through an aliased import,
  `apiCreateQuote`/`apiStartTrial`-style) against every call site in
  `apps/app`. Two of these were genuine bugs, not just missing
  explicitness: `apps/app/src/app/api/webhooks/stripe/route.ts` called
  `handleStripeWebhook(...)` without `await`, so its own `try/catch` could
  never actually catch a verification failure (the promise rejects after
  the `try` block has already returned a 200); the same class of bug
  existed in `subscriptionActions.ts`'s `chooseSelfInstallAction`.
- **`node:sqlite` fully retired from production code**: `db/client.ts`,
  `db/migrate.ts`, and the entire `db/migrations/` directory (the 8
  historical SQLite migration files) deleted outright — nothing imports
  them any longer. The only remaining `node:sqlite` mentions in the
  repository are historical comments (this file's own client/migrate
  modules explaining what they replaced) and two `apps/app` files
  (`middleware.ts`, `lib/quoteActions.ts`) whose comments explain why they
  must never import `@tallyvis/api` — neither ever actually imported
  `node:sqlite`. The local dev SQLite file
  (`services/api/data/tallyvis.dev.db`) was left on disk, untouched and
  gitignored — it's simply unused now, not deleted, since it wasn't this
  work's data to discard.
- **`services/api/.env.local`**: a new, hermetic, package-local env file
  (gitignored, `DATABASE_URL`/`DIRECT_URL` only) so `pnpm test` for this
  package never accidentally inherits `apps/app/.env.local`'s unrelated
  credentials (Resend, Stripe, Google) — discovered the hard way when an
  early test run fired real Resend API calls against fixture addresses.
  `vitest.config.ts` loads it directly (a ~10-line inline parser, not the
  `dotenv` package, for two known simple values).

## Production migration strategy (addendum — post-deployment incident)

Written after this ADR's original "What remains" list was closed out and
the app was actually deployed to Vercel with a real Neon database. The
"Migration system" section above described migrations as safe to run "on
every process start" — that assumption was never re-validated against
Vercel specifically, and it was wrong.

**The incident.** Once `db/pg/client.ts`'s `getDb()` was wired to call
`runMigrations(pool)` lazily on first use (one `migratedPromise` per warm
process, mirroring the retired SQLite client's own pattern), every
database-touching request in production — manual login, Google
login/signup, and estimator analysis alike, since all three eventually
call `getDb()` — failed identically with:

```
ENOENT: no such file or directory, scandir '/var/task/services/api/src/db/pg/migrations'
```

**Root cause, proven from source and Vercel's own bundling behavior, not
assumed.** `runMigrations` computed its migrations directory at runtime
(`path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations")`)
and called `readdirSync` on it to discover which `.sql` files existed.
Vercel's serverless function bundler (`@vercel/nft`, used by the Next.js
build) decides what to include in a deployed function by statically
tracing `import`/`require` statements — it has no way to see that a
runtime-computed `readdirSync()` call needs a sibling directory of data
files, because nothing ever `import`s or `require`s those `.sql` files by
name. They were silently absent from the deployed bundle. Locally this
was invisible because `pnpm dev`/`pnpm build && pnpm start` run against
the real, uncompressed source tree, where the `migrations/` directory is
right there on disk — the failure mode only exists once code runs from a
Vercel-traced bundle, which is exactly why local success and Vercel
failure diverged. Confirmed by inspecting `@vercel/nft`'s tracing
behavior and by the fact that the fix below (removing the runtime
`readdirSync` dependency from the request path entirely) is what actually
resolved it, not a bundler-configuration workaround.

**Why this was an architecture problem, not just a bug.** Beyond the
immediate `ENOENT`, running migrations from `getDb()` was never safe on
Vercel in the first place: a module-level "have I migrated yet" flag lives
in ONE warm process's memory, and Vercel routinely runs many concurrent
instances with no shared memory — so multiple instances could each decide
independently that they need to run migrations and race each other on
first traffic after a deploy. A request-time migration also means a
schema change ships exactly when the first customer request happens to
trigger it, not on a controlled, observable, revertible schedule, and a
migration failure would surface as a broken customer request instead of a
failed, visible deploy step.

**Chosen fix: migrations became a deploy-time-only operation; the request
path only ever verifies, never mutates.**

- `db/pg/migrate.ts`'s `runMigrations(pool)` still applies migrations, and
  still only what's missing (idempotent), but now iterates a hardcoded,
  checked-in manifest (`db/pg/migrations.ts`'s `MIGRATION_FILENAMES`)
  instead of `readdirSync`-ing the directory — `readFileSync` for a known
  filename is the only filesystem access left, and it never runs from a
  Vercel serverless function, only from a real machine with the full
  source tree.
- Its only callers now are `db/runMigrationsCli.ts` (the
  `pnpm --filter @tallyvis/api db:migrate` command — a human or a CI/CD
  deploy step runs this explicitly, connecting via `DIRECT_URL`, an
  unpooled connection, since Neon's pooled endpoint isn't suited to a
  long-lived DDL session) and this package's own test harness
  (`testDb.ts`, which needs a real schema created before each test file's
  suite runs and always has full filesystem access under `vitest`).
- `db/pg/client.ts`'s `getDb()` no longer calls `runMigrations` at all.
  Instead it calls a new `assertSchemaUpToDate(pool)` once per warm
  process: a single read-only `SELECT name FROM schema_migrations`,
  compared against the same `MIGRATION_FILENAMES` manifest. It never
  touches the filesystem and never mutates the database — just fails
  loudly, with a specific "which migration(s) are missing, run
  `db:migrate`" message, if the deployed code expects a schema state the
  database doesn't have yet. This directly satisfies "an outdated
  production schema must not be silently accepted" without adding
  per-request database overhead — the check runs once per warm process
  (same lazy-singleton-promise pattern the old migration call used),
  not once per request.

**Concurrency.** Two migration runs against the same schema (e.g. a
redeploy's own migrate step and a human running `db:migrate` by hand at
the same time) are serialized by a session-level Postgres advisory lock,
held for `runMigrations`'s entire duration:
`pg_advisory_lock(hashtext('tallyvis:migrations'), hashtext(current_schema()))`.
Advisory locks are scoped **per database, not per schema** (confirmed
against PostgreSQL's own documentation, `view-pg-locks.html`: "Advisory
locks are local to each database"), which is exactly why `current_schema()`
is folded into the lock key rather than using a single fixed key: this
package's test harness gives every test FILE its own distinct,
randomly-named schema against the SAME physical database, so a schema-blind
lock would have serialized the entire parallel test suite. With the
schema in the key, different test files never contend (different lock
keys) while production's one real schema always maps to the same key
(genuine protection). The lock is released in a `finally` and also
auto-releases if the holding connection drops.

**Why this fits Vercel specifically.** Migrations as an explicit,
human/deploy-triggered command is the standard pattern for serverless
platforms with no persistent "run this once at boot" process and no
shared memory across instances — there is no equivalent of a traditional
server's single startup hook to lean on. Read-only schema verification at
request time is cheap (one query, cached per warm process) and gives a
clear, actionable failure instead of either a filesystem crash or silent
operation against a schema the code doesn't actually match.

**Deployment procedure.** Before deploying a build that depends on a new
migration: run `pnpm --filter @tallyvis/api db:migrate` (with `DIRECT_URL`
— and, for safety, `DATABASE_URL` — pointed at the target database)
first, confirm it succeeds, then deploy the code. Deploying code ahead of
its migration is caught (loudly, at the schema-check point, not
silently) rather than prevented outright — there is no CI gate wired up
yet to block that ordering mechanically.

**Rollback/failure behavior.** A migration file that fails rolls back its
own transaction and throws, leaving `schema_migrations` exactly as it was
before that file started — safe to fix the SQL and re-run `db:migrate`,
which skips every already-applied file. There is no automatic
down-migration; rolling back a bad migration means writing and running a
new forward migration that undoes it, consistent with this repository's
existing "migrations are forward-only" convention (no `.down.sql` files
ever existed here, SQLite era included).

## What remains

Not part of this phase, and not started:

- Deploying to Vercel itself.
- Provisioning a separate PRODUCTION database (this phase's `DATABASE_URL`
  points at a development database; see "Data migration strategy" above
  for why production intentionally starts clean rather than importing
  local dev data).
- Configuring live (non-test-mode) Stripe credentials.
- A human smoke test of the running application against Postgres locally
  (Part 24 of the mission) — required before this phase can be considered
  fully verified, not just automated-test-verified.
