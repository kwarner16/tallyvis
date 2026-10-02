# 0035 — Internal TallyVis CEO/Admin dashboard (V1)

**Status:** Accepted (MRR/past_due handling superseded — see
docs/decisions/0036-subscription-provider-status.md)

> **Note (2026-10):** this ADR's original "Metrics" MRR definition and the
> "Risks" entry about `past_due` being indistinguishable from `active`
> have been superseded by ADR 0036, which adds a separate
> `subscriptions.provider_status` column and splits MRR into
> `activeMrrCents`/`pastDueMrrCents`. The rest of this ADR (architecture,
> authorization, schema, files, non-MRR metrics) is still accurate and
> unchanged.

## Context

TallyVis had no internal, platform-wide view of itself — no way for the
founder to see how many businesses had signed up, how many were trialing
vs. paying, what MRR looked like, or how much product usage (quotes,
customers) existed across every tenant. Every existing page in `apps/app`
is deliberately scoped to the signed-in business's own data
(`requireContext()` → `AuthSession.businessId`); there was no
authorization concept broader than "this one business," and no admin role
anywhere in the schema.

## What was investigated before writing any code

- **Auth/session**: opaque, hashed, database-backed session tokens
  (`services/api/src/auth/session.ts`), resolved via
  `apps/app/src/lib/session.ts`'s `requireContext()`. No existing
  role/permission field anywhere (confirmed: no `role`/`permission` column
  in any migration before this one, no admin functionality anywhere in
  the codebase).
- **Subscriptions**: one row per business (`subscriptions`, `UNIQUE
  business_id`), `status` is one of `trialing | active | canceled |
  expired | incomplete`. `billingWebhooks.ts`'s `STRIPE_TO_INTERNAL_STATUS`
  maps Stripe's `past_due` to the internal `"active"` status (the business
  keeps product access during Stripe's dunning/grace period — see
  `subscriptions.ts`'s `hasProductAccess`) — **this schema cannot
  distinguish "active and current" from "active but past due"** without
  either a schema change or a live Stripe call per subscription. Neither
  was done for V1; see "Deferred Features" and "Risks" below.
- **Plan pricing**: `@tallyvis/config`'s `PLANS` is the single
  authoritative price per plan (`monthlyPriceCents`) — the same values the
  checkout flow itself uses to resolve a Stripe Price id. `subscriptions`
  has no amount/price column of its own.
- **Quotes/customers**: both tables carry `business_id`, no existing
  cross-tenant query of either. `quotes.status` is one of `new |
  needs_review | more_information | approved | sent | accepted | declined`
  (`accepted`/`declined` are the only terminal states).
- **UI**: an existing `MetricCard` component (dashboard KPI cards),
  `DashboardShell` (sidebar nav shell), `theme.css` tokens including an
  unused-outside-marketing `charcoal-*` dark palette, `button-variants.ts`
  (including an `outline-dark` variant already built for dark
  backgrounds). No chart library anywhere in the repo.
- **Admin precedent**: `services/api/src/db/waiveInstallation.ts` already
  establishes the pattern for "a founder-only, one-off CLI script, run
  directly against the database, never a dashboard feature, never
  reachable from any customer-facing request path" — reused verbatim for
  granting admin access (see `grantAdmin.ts` below) rather than inventing
  a new convention.

## What was built

### Authorization — `users.is_admin`

A new `is_admin BOOLEAN NOT NULL DEFAULT FALSE` column on `users`
(migration `0012_admin.sql`) — the smallest possible addition, since no
existing role system was available to reuse. Lives on `users`, not
`businesses`, because an `AuthSession` is inherently per-login
(`userId` + `businessId`), and authorization needs to answer "is this
*person* allowed," not "is this *tenant* allowed." Every existing account
defaults to `FALSE`; this migration never grants admin access to anyone.

**Enforced at two independent layers**, both re-reading the database fresh
on every check (never a cached session flag, never anything client-side):

1. `services/api/src/services/auth.ts`'s `isAdminSession(db, session)` —
   the one primitive.
2. `apps/app/src/lib/adminSession.ts`'s `requireAdminContext()` — calls
   `requireContext()` first (redirects to `/login` if unauthenticated),
   then `isAdminSession`, redirecting a non-admin to their own
   `/dashboard` (never an error page that confirms `/admin` exists).
   Called by every `/admin/*` page's layout AND by every individual page
   (mirroring the existing `requireContext()` convention, where
   `dashboard/layout.tsx` and every page under it each call it
   independently).
3. **Every exported function in `services/api/src/services/admin.ts`**
   (`getAdminOverview`, `listBusinessesAdmin`, `getBusinessDetailAdmin`,
   `listSubscriptionsAdmin`, `listRecentActivityAdmin`) independently calls
   the same `isAdminSession` check itself (via an internal `requireAdmin`
   helper) and throws before touching any cross-tenant data. This means a
   future admin route that forgets to call `requireAdminContext()` still
   cannot read real data — defense in depth, and the layer that's actually
   unit-tested (see "Testing" below; `apps/app` has no test suite of its
   own).

Granting admin access has **no UI control anywhere** — the only write path
for `users.is_admin` is `repositories/users.ts`'s `setUserIsAdmin`, called
exclusively from the new `grantAdmin.ts` CLI script (same shape as
`waiveInstallation.ts`):

```
pnpm --filter @tallyvis/api grant-admin <email>            # grant
pnpm --filter @tallyvis/api grant-admin <email> --revoke    # revoke
```

### Data layer

- `repositories/admin.ts` (new) — every cross-tenant SQL query this
  feature needs: business counts (total/7d/30d), quote counts
  (total/7d/30d/accepted/declined/pending-open), customer count, a
  paginated+searchable+sortable business list, and a derived
  recent-activity feed. Deliberately isolated in its own file with a
  header comment stating it must only ever be imported from
  `services/admin.ts`.
- `repositories/subscriptions.ts` gained one addition:
  `listAllSubscriptionsWithBusinessName` — the one cross-tenant query that
  table needs (bounded by business count, one row per business).
- `repositories/users.ts` gained `listUsersForBusiness` (business detail
  page's owner lookup), `getUserByEmail` and `setUserIsAdmin` (the
  `grantAdmin` script's only two calls).
- `services/admin.ts` (new) — the business logic: `calculateMrrCents`
  (pure), day-bucketing for the growth chart (pure, JS not SQL — see
  "Metrics"), and the five session-gated, cross-tenant read functions
  listed above.

### Routing & UI (`apps/app`)

- `/admin` (Overview), `/admin/businesses` (+ `/admin/businesses/[id]`
  detail), `/admin/subscriptions`, `/admin/activity` — a new top-level
  route segment, sibling to `/dashboard`, not nested inside it (so it gets
  its own layout/shell entirely, and `DashboardShell`'s nav never needs to
  know admin routes exist).
- `AdminShell` — a dark (`charcoal-950`) sidebar shell, deliberately
  visually distinct from `DashboardShell`'s light customer theme, reusing
  existing design tokens (no new colors invented) so there's never a
  moment of confusion about which area is open.
- `MetricCard` (existing component) is reused as-is for every KPI card.
- `GrowthChart` (new) — a dependency-free CSS bar chart; no charting
  library was added (none existed, and one 30-point daily series doesn't
  justify adding one).
- `BusinessesTable` / `RecentActivityFeed` (new) — presentational only;
  all data access happens in the page Server Components.

## Database changes

**Migration `0012_admin.sql`** (registered in `migrations.ts`):

```sql
ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX idx_businesses_created_at ON businesses(created_at);
CREATE INDEX idx_quotes_created_at ON quotes(created_at);
```

All three statements are additive and safe against the existing
production database: a `BOOLEAN ... DEFAULT FALSE` column add is a
metadata-only change in Postgres (no table rewrite, no lock held beyond
the DDL statement itself), and both `CREATE INDEX` statements are on
tables small enough that the brief exclusive lock they take is immaterial
today. No existing row, column, or constraint is touched. Nothing here
grants admin access to anyone — that is a deliberate, separate, out-of-band
step (see "Production Setup" below).

## Metrics — exact definitions

- **MRR**: sum, over every subscription with `status === "active"`, of
  that subscription's plan's `monthlyPriceCents` (from `@tallyvis/config`'s
  `PLANS` — the authoritative price, never a value stored on the
  subscription row, since none exists). `trialing` is excluded (Stripe
  isn't charging yet). `canceled`/`expired`/`incomplete` are excluded (no
  revenue being collected). Stripe's `past_due` is **included** under
  `"active"` by the existing status-mapping design (see "Context" above)
  — a past-due subscription Stripe is still attempting to collect counts
  the same as any current one; this schema cannot separate the two without
  further work (see "Risks"). One-time charges (`billing_charges` — the
  $299 installation fee) are a completely separate table
  `calculateMrrCents` never reads, so they can never inflate MRR — directly
  tested (see "Testing").
- **Business counts**: `total`, `last7Days`, `last30Days` — plain
  `COUNT(*) FILTER (WHERE created_at >= $cutoff)` against
  `businesses.created_at`, where `$cutoff` is a JS-computed
  `new Date(...).toISOString()` string. This is a plain string
  comparison (fixed-width, zero-padded, UTC timestamps sort identically to
  chronological order), not SQL-side date arithmetic — doesn't conflict
  with `docs/decisions/0021-postgres-migration.md`'s reason for keeping
  these columns as TEXT.
- **Quote counts**: `total`/`7d`/`30d` the same way; `accepted` = `status
  = 'accepted'`; `declined` = `status = 'declined'`; `pendingOpen` = every
  other status (the five non-terminal ones).
- **Growth chart**: raw `created_at` timestamps within the last 30 days
  are fetched (one indexed range-scan query per series), then bucketed
  into UTC calendar days in JS — consistent with the "no SQL-side date
  arithmetic" convention, and because the growth chart is the one place
  genuinely-flexible bucketing (not just a threshold comparison) is
  needed.
- **Recent activity**: derived entirely from six existing timestamp
  columns (`businesses.created_at`, `subscriptions.created_at`/
  `canceled_at`, `quotes.created_at`/`accepted_at`/`declined_at`) — see
  "Deferred Features" for why this isn't a dedicated event table yet.

## Testing

`services/api/src/__tests__/admin.test.ts` (new, 17 tests) covers:

- `isAdminSession` is false by default, and flips immediately (no
  re-login needed) once `users.is_admin` is set.
- **Every** exported admin service function independently rejects a
  normal, authenticated, non-admin session — proving authorization is
  enforced at the service layer, not merely by the UI/route gate.
- `calculateMrrCents` correctly includes `active` and excludes
  `trialing`/`canceled`/`expired`/`incomplete`, individually and in a
  mixed multi-business set.
- A real `billing_charges` row (paid installation fee) never inflates
  MRR.
- `listBusinessesAdmin` sees businesses across every tenant (not just the
  admin's own), search matches by business name or owner email, and
  pagination returns a stable total with distinct rows per page.
- `getBusinessDetailAdmin` never leaks cross-tenant quote/customer counts
  (business A's detail never includes business B's data), correctly
  counts accepted/declined for the inspected business only, and returns
  `undefined` for a nonexistent id.
- `listSubscriptionsAdmin` reports the correct per-row MRR contribution.

`services/api/src/__tests__/migrations.test.ts` gained one new test:
`users.is_admin` defaults to `FALSE` on a freshly-migrated schema.

**Executed, with results:**

- `pnpm --filter @tallyvis/api test`: **451/451 passing** (17 new admin
  tests + 1 new migration test; all 433 pre-existing tests, including
  every auth/trial/multi-tenancy/billing suite, still pass unchanged).
- Root `pnpm typecheck`: clean across all 8 workspace packages.
- Root `pnpm lint`: clean across all 8 workspace packages.
- Root `pnpm build`: clean — `apps/app`'s build output confirms every new
  `/admin`, `/admin/activity`, `/admin/businesses`,
  `/admin/businesses/[id]`, `/admin/subscriptions` route compiles and is
  correctly marked dynamic (ƒ), and `apps/web`'s unrelated build is
  unaffected.

No UI/browser verification was performed (no browser tool available in
this environment) — the dashboard's actual rendering in a browser is
unverified; only server-side logic, authorization, and data correctness
are confirmed by the automated tests above.

## Production setup

1. Deploy this code (migration `0012_admin.sql` applies automatically via
   the existing `pnpm --filter @tallyvis/api db:migrate` deploy step —
   same process as every prior migration).
2. Grant yourself admin access:
   `pnpm --filter @tallyvis/api grant-admin kyle@tallyvis.com` (run against
   the same `DATABASE_URL` the production deploy uses — the identical
   pattern already used for `db:migrate`/`seed`/`waive-installation`).
3. Log in normally at `/login`; `/admin` is now reachable from your
   session. No restart, redeploy, or re-login beyond a normal session
   refresh is required — `isAdminSession` reads `users.is_admin` fresh on
   every request.

## Deferred features

Left for a future pass, each because it would require more than the
smallest change this V1 needed:

- **A real past-due/dunning signal**, separate from `"active"` — needs
  either a schema change (a new column distinguishing Stripe's `past_due`
  from `active`) or a live per-subscription Stripe call; neither was worth
  it for V1 observability.
- **A dedicated audit/event table** — today's "Recent activity" is
  entirely derived from existing timestamp columns, which means it can
  only ever show the six event types those columns already capture.
  Logins, plan changes, admin notes, or any other event type would need a
  real table.
- **Per-business profitability, AI usage/cost, SMS/email usage, API usage,
  system health/error monitoring, support/customer health, churn, ARR,
  trial-to-paid conversion, cohort retention, feature flags** — none of
  this data is currently tracked anywhere in the schema; this ADR's
  "Future Architecture" intent is simply that nothing built here makes
  adding them later harder (new repository functions in `admin.ts`, new
  service functions in `services/admin.ts`, same two-layer authorization
  pattern).
- **Admin mutation actions** (editing a business, refunding a charge,
  impersonating a customer) — V1 is deliberately read-only observability,
  per the original request.
- **A per-quote admin detail page** — the business detail page shows the
  10 most recent quotes read-only; drilling into one isn't built.

## Risks / issues found during investigation

- **MRR cannot distinguish "active and current" from "active but
  past-due."** This is an existing, deliberate design choice from
  `billingWebhooks.ts` (not introduced by this work), but it means the
  admin dashboard's MRR number is not a precise "revenue actually
  collected this period" figure — it's "revenue TallyVis currently expects
  to collect," which may be briefly ahead of reality during Stripe's
  dunning window. Flagging this explicitly since the task described "past
  due" as its own bucket, which this schema cannot produce.
- **`billing_charges` has no `(business_id, kind)` uniqueness constraint**
  (documented in `0004_accounts_billing.sql`'s own comment, pre-existing,
  not changed here) — not an admin-dashboard bug, but worth noting since
  the business detail page could in principle show more than one
  installation charge per business if that ever happens; V1 doesn't
  surface `billing_charges` on the detail page at all, so this isn't
  currently visible there.
- No other correctness, security, or architectural issues were found in
  the authentication, subscription, quote, or customer systems during this
  investigation.
