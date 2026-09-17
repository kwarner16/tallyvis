# services/api

Tallyvis's backend: authentication, persistence, and the authorization
boundary every business-owned record (`Business`, `Customer`,
`PricingConfiguration`, `Quote`) goes through. See
`docs/decisions/0011-persistence-auth-and-multi-tenancy.md` for the
reasoning behind the choices below.

- **Database:** SQLite via Node's built-in `node:sqlite` (no native
  dependency to compile). One file per environment, resolved from
  `DATABASE_URL` (see the root `.env.example`); defaults to
  `services/api/data/tallyvis.dev.db` (gitignored) for local development.
- **Schema/migrations:** plain `.sql` files in `src/db/migrations/`,
  applied in order and tracked in a `schema_migrations` table by
  `src/db/migrate.ts`. Runs automatically the first time `getDb()` is
  called — nothing to run by hand for local dev.
- **Layers:** `repositories/` are the only files that write SQL, always
  scoped by `business_id` in the query itself. `services/` sit on top,
  taking an `AuthSession` (never a bare id) and enforcing the actual
  authorization rule: a caller can only ever read or write the business
  their session belongs to. `index.ts` is the only file anything outside
  this package should import from.
- **Auth:** password hashing via `bcryptjs`; sessions are opaque random
  tokens (`node:crypto`'s `randomBytes`), stored in the database only as a
  SHA-256 hash, set as an httpOnly cookie by `apps/app`. No JWTs, no
  third-party auth provider, no custom cryptographic primitives — see the
  ADR for why.

## Local setup

```sh
pnpm --filter @tallyvis/api seed   # creates the demo business + owner login
```

This prints the demo login (`owner@demowindowcleaning.example` /
`tallyvis-dev-password`) to use signing in to `apps/app` locally. Safe to
re-run — it's a no-op if that account already exists.

## Tests

`pnpm --filter @tallyvis/api test` — every test gets its own fresh
in-memory database (`createTestDb()`), so tests never touch the dev
database file and never leak state into one another.
