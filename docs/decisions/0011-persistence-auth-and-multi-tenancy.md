# 0011 — Real persistence, authentication, and multi-tenancy

**Status:** Accepted (Phase 9)

## Context

Everything through Phase 8 ran on one `localStorage`-backed mock store
(`apps/app/src/lib/quotes/store.ts`) seeded with one hardcoded demo
business (`packages/config`'s `demoBusiness`). That was the right call for
every phase up to now — ADRs 0005, 0007, 0008, and 0009 each explicitly
deferred "a real backend" to the point where the product actually needed
multiple businesses, real accounts, and data that survives more than one
browser tab. Phase 9 is that point: Tallyvis needs to be usable by more
than one business at once, each with data the others can never see, none
of it living only in one browser's `localStorage`.

## Decision

### Database: SQLite via `node:sqlite`, no ORM

`services/api` (previously a README stub, now real) owns a single SQLite
database file. Three things ruled out the obvious alternatives:

- **No native dependency to compile.** This repo already hit real friction
  from Windows/OneDrive file-locking on `.next` build output during Phases
  6–8; adding a native-module database driver (`better-sqlite3`, `pg`) into
  that same environment was an unnecessary new failure mode. `node:sqlite`
  is a Node built-in (stable enough in Node ≥22.5, hence this phase's
  `engines.node` bump) — nothing to install, nothing to compile.
- **No external server to run.** A real Postgres/MySQL instance would be a
  more "production" choice eventually, but requires infrastructure
  (Docker, a hosted DB, connection secrets) this phase doesn't need yet to
  prove out the actual requirement: real persistence, real auth, real
  tenant isolation. `DATABASE_URL` (see `.env.example`) already anticipates
  swapping this for a hosted database later without changing anything
  above the repository layer.
- **No ORM.** Given the schema's size (five tables) and that hand-written
  SQL avoids betting on an ORM's compatibility with a very new Node
  built-in, `services/api/src/repositories/*.ts` write plain parameterized
  SQL directly. `src/db/migrations/*.sql` are plain files, applied in
  order and tracked in a `schema_migrations` table by `src/db/migrate.ts`
  — no migration framework, just enough to be idempotent and re-runnable.

One implementation wrinkle worth recording: `node:sqlite` has no
non-prefixed alias, and neither Vite (services/api's test runner) nor
Turbopack (apps/app's bundler) reliably recognize it as a Node builtin
when it's imported with a normal `import` statement — both tried to
resolve it as an npm package named `sqlite` and failed. `db/client.ts`
works around this with `process.getBuiltinModule("node:sqlite")`, a plain
runtime call invisible to static import analysis, instead of a literal
`import` of the value (type-only imports, which get erased before any
bundler sees them, are unaffected and used everywhere else).

### Layering: repositories → services → apps/app's Server Actions

```
apps/app (Server Components + Server Actions)
        ↓
services/api's service layer (services/*.ts) — takes an AuthSession
        ↓
services/api's repository layer (repositories/*.ts) — takes a businessId
        ↓
SQLite (services/api's data/*.db)
```

`services/api/src/index.ts` is the only file anything outside the package
should import — repositories and the raw `db` client stay internal, so the
"every business-owned read/write is scoped by a caller-supplied identity"
rule can't be bypassed by reaching past the service layer. Every
repository function takes a `businessId` string and puts it in the `WHERE`
clause itself (not a separate check afterward); every service function
takes an `AuthSession` (`{ userId, businessId }`) instead of a bare id, so
a caller can only ever act as the business their session says they belong
to.

### Authentication: sessions, not JWTs; hashed at rest

- **Passwords:** `bcryptjs` (pure JS, no native compile step) — an
  established library, not custom cryptography.
- **Sessions:** an opaque, high-entropy random token
  (`node:crypto`'s `randomBytes(32)`), set as an httpOnly, `sameSite=lax`
  cookie. The database never stores the raw token, only its SHA-256 hash
  (`services/api/src/auth/session.ts`) — a stolen database row alone is
  not a usable session credential. This is a deliberate choice over a
  signed JWT: an opaque token can be revoked immediately (delete the row)
  rather than waiting out an expiry, and there's no signing secret to
  manage or rotate. No third-party auth framework (NextAuth/Auth.js,
  Lucia, ...) was pulled in — the surface needed (email+password,
  httpOnly session cookie, logout) is small enough that a dependency with
  its own provider/adapter model would have added more surface area than
  it removed, especially against a very new Next 16 / React 19 stack
  where such a framework's compatibility wasn't a given.
- **Middleware is a UX shortcut, not the security boundary.**
  `apps/app/middleware.ts` runs in the Edge Runtime, which has no Node
  builtins — it can't reach `node:sqlite` to validate a session, so it only
  checks that a session cookie is *present* and redirects to `/login` if
  not. The actual, authoritative check is `requireContext()`
  (`apps/app/src/lib/session.ts`), which every dashboard Server
  Component/Action calls to resolve the cookie against the database before
  touching any business data. Middleware failing open would only cost a
  wasted render, never a data leak.

### Multi-tenancy: `businessId` on every owned table, enforced in SQL

`businesses`, `users`, `pricing_configurations`, `customers`, and `quotes`
all carry `business_id`. Every repository read/write filters by it in the
query itself. `Quote.pricingConfigId` — the Phase 6 invariant that a
quote's pricing never silently changes when a business edits its rates —
survives unchanged: `pricing_configurations` is append-only (a new row per
version, never an `UPDATE` to `rules_json`), and a quote's pinned id still
resolves to the exact version that priced it, indefinitely.

`Customer` is newly normalized into its own table (`Quote.customerId` is a
real foreign key) rather than only ever embedded on a `Quote`, the
simplification ADR 0008 explicitly flagged as temporary ("a real backend
would normalize these into their own tables... introducing that
normalization now... would be speculative complexity" — this is that real
backend). The shared `Quote` type still carries a hydrated `customer`
object alongside `customerId` (joined in `repositories/quotes.ts`), so
every existing UI component reading `quote.customer.name` kept working
unchanged — the normalization happened at the persistence layer without
forcing a parallel rewrite of code that didn't need to change.

### The two deliberate exceptions to "always require a session"

Two routes are legitimately public and pre-date having any account at
all, so they can't go through `requireContext()`:

1. **The customer estimator (`/estimate/*`).** It creates a quote before
   any business relationship exists from the visitor's side. Real
   multi-business public routing (a slug or subdomain per business) is
   out of Phase 9's scope — building it now would be new, unrequested
   product surface, not part of "real persistence, auth, and tenant
   isolation." Instead, `services/api`'s `getDefaultPublicBusiness()`
   resolves to whichever business signed up first (in practice, the
   seeded demo business), used only by `apps/app/src/lib/publicActions.ts`.
   This is a stated simplification, not a hidden one — both the function
   and the ADR say so — and it only affects which business the public
   wizard quotes against, never which business a signed-in dashboard user
   can see.

   Because this path takes input from someone who has proved nothing about
   who they are, it carries one invariant that must not be relaxed later:
   **an anonymous submission never resolves onto a `Customer` record that
   already exists.** `createQuotePublic` always creates a fresh customer row
   (`createCustomerForBusiness`), where the signed-in dashboard's
   `createQuote` reuses a matching one (`findOrCreateCustomer`). Matching on
   an unverified email here would make the endpoint an oracle: submit a
   guessed address, and the created quote — and the `/quote/[id]` page it
   yields — would hand back that customer's real name, phone, and address.
   The cost is a duplicate customer row when a genuine returning customer
   re-submits; that is a tidiness problem the business can reconcile, and a
   far better trade than a lookup service for its customer list. For the
   same reason `createPublicQuoteAction` returns only the new quote's id
   rather than the whole persisted `Quote`.
2. **The customer-facing quote view (`/quote/[id]`)**, unchanged from its
   Phase 8 design (`docs/decisions/0010-quote-creation-and-customer-view.md`):
   `quote.id` is an unguessable-but-unauthenticated token. `getQuotePublic`
   is read-only — nothing reachable from that route can mutate a quote —
   and the limitation (no real link delivery, no verification the viewer
   is that quote's customer) is documented in the route's own file comment
   as future work, not silently missing.

Neither of these weakens the dashboard's isolation: every dashboard
Server Action still requires a real, validated session, and both public
paths are read/create-only for data that route was always meant to touch.

## Consequences

- `packages/pricing` and `packages/types` are largely unchanged in
  *behavior* — `calculateEstimate()` remains the only pricing entry point,
  called from exactly the same places (now server-side inside
  `services/api`, plus client-side live previews that never get persisted
  directly). `packages/types` gained `Business`, `CustomerInput`, and an
  `id`/`businessId` on `Customer` — additive, not breaking, for every
  field that already existed.
- `apps/app`'s old mock store (`lib/quotes/store.ts`, `lib/quotes/seedQuotes.ts`,
  `lib/pricingReconciliation.ts`) and its test suite are deleted, not
  deprecated in place — every consumer was migrated to Server
  Actions/Server Components backed by `services/api` in the same change,
  so nothing was left half-migrated. The Phase 8 store tests' scenarios
  (versioning, historical pricing, quote CRUD) now live in
  `services/api/src/__tests__/`, where the logic they test actually lives.
- `demoBusiness`/`demoPricingConfiguration`/`windowCleaningDefaultPricingRules`
  in `packages/config` are unchanged and still useful — as the shape a
  brand-new signup's starter pricing configuration is seeded from
  (`services/api/src/services/auth.ts`), as `services/api`'s dev seed
  script's demo business, and as `apps/web`'s standalone marketing demo,
  which has no business/account concept at all and was never part of this
  migration.
- Data now genuinely survives page refreshes, browser restarts, and
  server restarts — the thing `localStorage` structurally couldn't do
  across devices or after clearing site data.
- Known gap, stated rather than hidden: the public estimator's
  single-business resolution (above) is real scope left for a later
  phase, once multi-business public routing is actually needed.
