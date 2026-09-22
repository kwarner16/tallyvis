# 0021 — Postgres migration (Phase 1 of production readiness)

**Status:** In progress — schema and migration system designed; repository-layer port not yet started (see "What this ADR does NOT cover" below).

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
filename and underlying error, stopping whatever called it (a deploy
script, or — for now, mirroring the SQLite version's own "safe to call on
every process start" design — the app's own startup path once
`db/pg/client.ts` is actually wired in).

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

## What this ADR does NOT cover yet

Deliberately stopped here, before:

- Porting any of the 12 repository files or 15 service files from
  synchronous `node:sqlite` calls to `async`/`await` `pg` calls (Part 10).
- Updating any of the ~20 test files or any `apps/app` caller for the
  resulting async signatures (Part 10/17).
- Writing the Postgres-backed integration test suite (Part 17).
- Touching `.env.example`'s `DATABASE_URL` documentation — it currently,
  correctly, still describes the SQLite file-path meaning, because the
  running application has not been cut over yet. Rewriting that
  documentation now would describe behavior that doesn't exist yet.

All of the above requires a real, reachable Postgres connection to
develop and verify against — writing ~90 queries' worth of async
repository code blind, with no way to confirm it actually behaves
correctly against real Postgres semantics (parameter binding, transaction
behavior, the partial unique index, the boolean column, etc.), is exactly
the "blind conversion" the mission's own Part 2 says not to do. See the
message accompanying this report for the concrete provider recommendation
and what's needed to continue.
