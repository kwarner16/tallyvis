# 0036 — Separating Stripe's raw billing status from TallyVis's entitlement status

**Status:** Accepted

## Context

The admin dashboard (ADR 0035) shipped an MRR figure that silently included
Stripe's `past_due` subscriptions inside "active" MRR, and had no way to
show a business as "past due" anywhere in the admin UI. This was flagged
as a real problem during review: the admin dashboard is supposed to give
a trustworthy, truthful view of platform billing health, and "active" and
"past due" are genuinely different facts that were being conflated.

## Root cause

`subscriptions.status` (added in Phase 14, ADR 0016) was always designed
as an **entitlement** signal, not a billing-health signal.
`services/billingWebhooks.ts`'s `STRIPE_TO_INTERNAL_STATUS` table
deliberately maps Stripe's `past_due` to the internal `"active"`:

```ts
const STRIPE_TO_INTERNAL_STATUS: Record<string, SubscriptionStatus> = {
  trialing: "trialing",
  active: "active",
  past_due: "active", // still has access during Stripe's own dunning/grace period
  canceled: "canceled",
  unpaid: "expired",
  incomplete: "incomplete",
  incomplete_expired: "expired",
  paused: "expired",
};
```

That mapping is **correct** for its actual purpose: `hasProductAccess`
(`services/subscriptions.ts`) reads exactly this column to decide whether
a business keeps using TallyVis, and a business should keep access during
Stripe's automated dunning/retry window rather than being locked out the
moment one payment attempt fails. The bug was reusing this single column
for a second, different purpose (admin billing-health reporting) that
needed a different answer to the same question.

## Investigation findings

1. **Stripe statuses TallyVis already handles**: `trialing`, `active`,
   `past_due`, `canceled`, `unpaid`, `incomplete`, `incomplete_expired`,
   `paused` — the complete `STRIPE_TO_INTERNAL_STATUS` key set.
2. **Where mapped**: `buildSubscriptionPatchFromStripe`
   (`billingWebhooks.ts`), called from `applyStripeSubscription` (every
   `customer.subscription.created`/`.updated`/`.deleted` webhook) and from
   `reconcileSubscriptionFromStripe` (`services/subscriptions.ts`, the
   existing lazy self-heal path for a stuck-`incomplete` row).
3. **What `subscriptions.status` represents**: TallyVis's own entitlement
   decision — read by exactly two call sites, both intentional and
   unchanged by this fix: `hasProductAccess` (the access gate) and
   `startTrial`'s `alreadyEntitled` check.
4. **Confirmed no other access logic depends on `status === "active"`** —
   grepped every reference across `services/api/src`; the only two
   non-admin, non-test reads are the ones above.
5. **Regression risk of changing `status` semantics directly**: high —
   `hasProductAccess`/`startTrial` and roughly 100 existing tests
   (`subscriptions.test.ts`, `billingWebhooks.test.ts`) depend on today's
   exact mapping. Changing what `"active"` means, or adding a new
   `"past_due"` value to `SubscriptionStatus` itself, would require
   auditing and likely changing every one of those call sites and tests.
6. **Smallest safe solution**: add a new, purely additive column that
   preserves Stripe's raw status *alongside* the existing one, and never
   touch `status`'s own semantics or any entitlement code path.

## Architecture chosen

**Preserve the raw Stripe status in an additional field** —
`subscriptions.provider_status` (migration `0013_subscription_provider_status.sql`,
nullable `TEXT`). This is the smallest of the options considered:

- *Expanding the status model* (e.g. adding `"past_due"` to
  `SubscriptionStatus`) would require `hasProductAccess`/`startTrial` to
  explicitly treat it as entitled too, duplicating logic the existing
  mapping already centralizes, and would ripple through every test that
  constructs a `Subscription` fixture.
- *Separating billing status from entitlement status as two first-class
  concepts* is effectively what was built — `status` stays entitlement,
  `providerStatus` is the new billing-health fact — just implemented as
  one additive column rather than a parallel table or a bigger refactor.

`providerStatus` is the exact, untranslated string Stripe sent on the
Subscription object's own `status` field — never combined with, or used
to influence, TallyVis's own `status`/entitlement computation.

**Set in exactly two places**, both already computing a status from a
real Stripe object:

- `buildSubscriptionPatchFromStripe` now also returns `providerStatus:
  stripeSub.status` — flows through `applyStripeSubscription` (every
  subscription-lifecycle webhook) and `reconcileSubscriptionFromStripe`
  (the lazy self-heal path).
- `checkout.session.completed` (no Subscription object in that payload)
  cannot set it — omitted, so `upsertSubscription`'s COALESCE-preserve
  leaves it untouched until the near-simultaneous
  `customer.subscription.created` event arrives.

## Entitlement behavior for past_due — explicitly unchanged

`hasProductAccess`, `resolveEffectiveStatus`, `startTrial`, and
`STRIPE_TO_INTERNAL_STATUS` itself are **not modified** by this fix. A
past-due business's `status` is still `"active"`, and it still has full
product access during Stripe's dunning/grace period — exactly the
existing, intentional policy. `isSubscriptionPastDue(subscription)` (new,
`services/admin.ts`) is a read-only, admin-only derived fact — `status
=== "active" && providerStatus === "past_due"` — that changes nothing
about what the business can do, only what the admin dashboard can see.

## MRR — revised definition

`calculateMrrCents` (one number) is replaced by `calculateMrrBreakdown`
(two numbers), exported as `MrrBreakdown`:

- **`activeMrrCents`**: every `status === "active"` subscription that is
  **not** confirmed `past_due`, at its plan's authoritative
  `@tallyvis/config` price. This is the clean, headline MRR figure.
- **`pastDueMrrCents`**: every `status === "active"` subscription that
  **is** confirmed `past_due`, at the same authoritative price — shown as
  a separate "exposure" figure rather than folded into `activeMrrCents`.
  This is the standard SaaS accounting treatment for delinquent-but-not-
  yet-churned revenue: real money TallyVis is owed and Stripe is still
  attempting to collect (Smart Retries), but not yet actually collected
  this period.
- `trialing`/`canceled`/`expired`/`incomplete` subscriptions contribute to
  neither figure.
- One-time charges (`billing_charges`) are a separate table this function
  never reads — directly tested (see "Testing").
- No double-counting risk: `subscriptions` has `UNIQUE(business_id)`, so
  each business contributes at most once, to at most one bucket.
- A subscription whose `providerStatus` is still `undefined` (not yet
  synced — see "Historical rows" below) is treated as clean and current,
  counted in `activeMrrCents`. This is a deliberate, documented
  optimistic default — it is never fabricated as `past_due`, and it
  matches `hasProductAccess`'s own long-standing default of granting
  access absent a concrete reason not to.

## Admin dashboard changes

- **Overview**: the single "Monthly recurring revenue" card is replaced
  by "Active MRR" and "Past-due MRR exposure" cards; the subscription
  count cards now show `Active`, `Past due`, `Trialing`, `Canceled` as a
  strict, non-overlapping partition (`AdminSubscriptionStatusCounts` now
  has six mutually-exclusive buckets: `trialing`/`active`/`pastDue`/
  `canceled`/`expired`/`incomplete`).
- **Subscriptions page**: regrouped from five sections (by raw `status`)
  to six (`Active`, `Past due`, `Trialing`, `Canceled`, `Incomplete`,
  `Expired / unpaid`), each row now shows Stripe's raw status string and
  a "Past due" badge next to its recurring value when applicable.
- **Businesses table / business detail page**: both now show "Past due"
  as a distinct status label (derived the same way) instead of "Active"
  whenever `providerStatus === "past_due"`.

## Historical rows — honest accounting

`provider_status` is added with **no backfill**. TallyVis has no record
of what Stripe's raw status actually was, at any point in the past, for
an existing subscription row — fabricating one (even "active" for a row
whose internal `status` already says `"active"`) would misrepresent real
billing history that was never actually observed. Every row starts
`NULL` and stays `NULL` until the next event that legitimately knows the
answer touches it:

- the next `customer.subscription.created`/`.updated`/`.deleted` webhook
  for that subscription (Stripe sends these routinely — at minimum every
  billing-period renewal, and immediately on any status change), or
- the existing `reconcileSubscriptionFromStripe` self-heal path, if that
  row is ever stuck `incomplete`.

Until then, `isSubscriptionPastDue` treats an unknown `providerStatus` as
"not past due" (see "MRR" above) — the admin dashboard will under-report
past-due exposure for any currently-past-due subscription that hasn't
had a webhook since this column was added, until its next Stripe event
arrives. This is a real, temporary, honestly-disclosed limitation, not a
bug: no mass Stripe API backfill was run against production as part of
this change (per the explicit instruction not to perform mass Stripe API
calls or production mutations without approval). A future, explicitly
approved one-off reconciliation script (iterating every subscription with
a `providerSubscriptionId` and calling Stripe's `retrieveSubscription`,
the same API `reconcileSubscriptionFromStripe` already uses) would close
this gap immediately for every existing row; it was not built or run here
because doing so unprompted would itself be a mass Stripe API call this
task explicitly said not to make without approval.

## Files changed

**New**: migration `0013_subscription_provider_status.sql`;
`docs/decisions/0036-subscription-provider-status.md` (this file).

**Modified**: `migrations.ts` (registered 0013);
`repositories/subscriptions.ts` (+`providerStatus` field, row mapping,
`UpsertSubscriptionInput.providerStatus` with COALESCE-preserve SQL);
`services/billingWebhooks.ts` (`SubscriptionPatchFromStripe.providerStatus`,
set from `stripeSub.status`, threaded through `applyStripeSubscription`);
`services/subscriptions.ts` (`reconcileSubscriptionFromStripe` now also
persists `providerStatus`); `services/admin.ts` (`isSubscriptionPastDue`,
`calculateMrrBreakdown`/`MrrBreakdown` replacing `calculateMrrCents`,
`AdminSubscriptionStatusCounts` gains `pastDue`, `AdminSubscriptionRow`
gains `providerStatus`/`isPastDue`/`recurringCents`/`mrrBucket`);
`repositories/admin.ts` (`AdminBusinessListRow`/query gain
`providerStatus`); `index.ts` (updated exports); apps/app's admin Overview
page, Subscriptions page, `BusinessesTable`, and business detail page
(all updated to surface the active/past-due distinction).

Also found and fixed during self-review (unrelated to the status
conflation itself, but a genuine small gap in this same admin-authorization
surface): `apps/app/middleware.ts`'s cheap edge pre-check matcher only
covered `/dashboard/:path*`, not `/admin/:path*` — extended to include
both; `authActions.ts`'s `sanitizeDashboardRedirect` only allowed a
`/dashboard`-prefixed post-login redirect, so an admin deep link bounced
through `/login` would always land on `/dashboard` instead of back where
they started — extended to also allow `/admin`-prefixed paths. Neither
was a security gap (the real authorization boundary is
`requireContext()`/`requireAdminContext()`, which both already covered
every route), just a UX/consistency gap.

## Testing

`services/api/src/__tests__/admin.test.ts`: 10 new tests —
`isSubscriptionPastDue`'s three cases; `calculateMrrBreakdown`'s full
behavior (active, past-due, unknown-provider-status, trialing, canceled,
expired/incomplete, and a realistic mixed set); a dedicated
`past_due billing status` suite proving active/past-due/trialing/canceled
are all independently distinguishable via a real `getAdminOverview` call
against a real database, AND that `hasProductAccess` still grants access
for the same past-due row; `listSubscriptionsAdmin`'s new
`providerStatus`/`isPastDue`/`mrrBucket` fields.

`services/api/src/__tests__/billingWebhooks.test.ts`: extended the two
existing `past_due`/`unpaid`/`incomplete_expired`/`paused` mapping tests
to also assert `providerStatus` is now captured correctly alongside the
unchanged internal `status`.

`services/api/src/__tests__/subscriptions.test.ts`: extended the existing
`reconcileSubscriptionFromStripe` self-heal test to also assert
`providerStatus` is populated by that path.

`services/api/src/__tests__/migrations.test.ts`: unchanged (no new table;
covered by the admin.test.ts/billingWebhooks.test.ts assertions above).

**Executed, with results:**

- `pnpm --filter @tallyvis/api test`: **461/461 passing** (10 new in
  `admin.test.ts`, bringing that file to 27; 2 extended assertions in
  `billingWebhooks.test.ts`; 1 extended assertion in
  `subscriptions.test.ts`; every pre-existing test, including the full
  trial-eligibility, multi-tenancy, and authentication suites, passes
  unchanged).
- Root `pnpm typecheck`/`pnpm lint`/`pnpm build`: clean across all 8
  workspace packages.

## UI smoke test

Performed against a real, throwaway Postgres **schema** inside the same
database (`admin_smoke_<random>`, migrated fresh, seeded with five
synthetic businesses — admin, normal, a clean-active subscriber, a
past-due subscriber, and a trialing one — then dropped immediately
afterward). No real/production data was read or written. A real `next
dev` instance was pointed at that schema only; real session tokens were
minted via the actual `logIn`/`signUp` service functions (never forged)
and driven over real HTTP with `curl` (no browser extension was available
in this environment to drive an actual browser).

Verified: unauthenticated → `/admin` and `/admin/businesses` both 307 to
`/login`. Normal authenticated customer → both 307 to `/dashboard` (their
own `/dashboard` still 200s normally). Admin → `/admin`, `/admin/businesses`,
`/admin/businesses/[id]`, `/admin/subscriptions`, `/admin/activity` all
200, zero error markers in the response bodies or server log. Overview
page rendered **Active MRR $159 / Past-due MRR exposure $299 / Active 1 /
Past due 1 / Trialing 1 / Canceled 0** — exactly matching the seeded
fixtures. Subscriptions page correctly grouped the clean-active business
under "Active (1)" and the delinquent one under "Past due (1)," each with
its own recurring value and a "Past due" badge where applicable. Business
detail page showed "Status: Active" / "Stripe raw status: active" for the
clean-active fixture.

## Deferred / risks

- **Historical rows stay `providerStatus: undefined` (optimistically
  "not past due") until their next webhook or reconciliation** — see
  "Historical rows" above. An explicitly-approved one-off Stripe
  reconciliation script would close this; not run here.
- **No automatic retroactive past-due backfill** was performed or
  proposed as something to run without the founder's explicit go-ahead.
- Everything already listed as deferred in ADR 0035 (audit/event table,
  churn/ARR/cohort analytics, admin mutation actions, etc.) remains
  deferred; nothing here changes that list.
