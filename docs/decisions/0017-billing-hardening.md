# 0017 — Billing/plan-selection hardening: fixing "Choose Plan"

**Status:** Accepted (Phase 14 hardening pass — not a new phase)

## Context

After Phase 14 shipped (commit `e6a1044`), manually clicking "Choose Plan"
in the dashboard produced an error. This ADR documents the audit that
found the root cause, the fix, and everything else the same audit pass
hardened in the billing/subscription/checkout/webhook flow before public
deployment. No new product surface was added — this is entirely
bug-fixing and hardening of what Phase 14 (ADR 0016) already built.

## Root cause

`apps/app/src/app/dashboard/onboarding/page.tsx` called
`cookies().delete(INTENDED_PLAN_COOKIE_NAME)` directly inside the page's
Server Component render body, to consume the one-time "intended plan"
cookie set at signup. Next.js only permits cookies to be mutated inside a
Server Action or Route Handler — calling `.delete()` (or `.set()`) during
a Server Component's render throws
`"Cookies can only be modified in a Server Action or Route Handler"`
unconditionally, on every single render of that page. This was
reproduced directly against the running dev server: a real session cookie
against `GET /dashboard/onboarding` returned `500`, with that exact
message and stack trace pointing at `OnboardingPage`.

This was not Stripe, not missing configuration, not an invalid plan id,
and not a database issue — a pure Next.js server/client (render vs.
action) boundary violation.

## Fix

The onboarding page now only ever *reads* the cookie (reading during
render is fine); it no longer deletes it. The cookie is instead cleared
as a side effect of `startTrialAction`/`createCheckoutSessionAction` in
`apps/app/src/lib/subscriptionActions.ts` — both real Server Actions,
where cookie mutation is legal — once a plan is actually chosen. If a
business never completes onboarding, the cookie simply expires on its own
(1 hour, unchanged from Phase 14); nothing depends on it being cleared
eagerly.

## Additional hardening found during the same audit

### Error sanitization (`subscriptionActions.ts`)

Both `startTrialAction` and `createCheckoutSessionAction` now catch every
exception, not just `BillingProviderError`. Only a small, deliberately
safe set of messages ever reaches the browser: `BillingProviderError`'s
own hand-written message, or a service-layer validation message matching
a known-safe pattern (e.g. `Unknown plan "..."`). Anything else — a
database error, a network failure, any unexpected exception — is logged
server-side with full detail (`console.error`) and replaced with one
generic message ("Could not start your trial. Please try again." /
"We couldn't start checkout. Please try again."). The browser never sees
a stack trace, a SQL error, or a raw provider exception.

`services/subscriptions.ts`'s "business not found" error no longer
includes the internal `businessId` in its message (a minor detail leak;
unreachable in practice since a valid session always resolves to a real
business, but not something worth leaving in the message either).

`services/api/src/billing/index.ts`'s "not configured" message was
reworded to match the brief's own suggested phrasing — "Billing isn't
configured yet. Please contact the Tallyvis team." — with the technical
detail (`STRIPE_SECRET_KEY is unset`) moved to a server-side
`console.error` only.

### `startTrial` — the trial clock is no longer resettable by re-selecting a plan

Before this pass, calling `startTrial` again (re-selecting the same plan,
or switching to a different one) unconditionally reset
`trialStartedAt`/`trialEndsAt` to a fresh 7 days from "now" — a business
could indefinitely extend a free trial by repeatedly clicking "Choose
plan." `startTrial` now only grants a fresh trial window when there is no
subscription row yet, or the existing one is `canceled`/`expired`/
`incomplete`. Re-selecting a plan while already `trialing` or `active`
only changes `planId`; the trial window is untouched.

### `upsertSubscription` — a genuine data-loss bug, fixed at the source

Investigating the trial-reset issue surfaced a more serious problem:
`repositories/subscriptions.ts`'s `upsertSubscription` UPDATE
unconditionally overwrote every column with whatever the caller passed
(`?? null` for anything omitted) — a full replace, not a patch. The old
`startTrial` only ever passed the trial-related fields, which meant
re-selecting a plan **silently wiped any already-linked Stripe customer
id, subscription id, or billing period** the business might already have
had from a prior real checkout. `upsertSubscription`'s optional fields
(everything except the always-required `planId`/`status`) now use
`COALESCE(?, existing_column)` on the UPDATE path — the same pattern
`repositories/quotes.ts`'s `recordQuoteViewed` already established for
the identical reason. Passing `undefined` for an optional field now
means "leave it as it was," not "erase it." `startTrial` and
`createCheckoutSessionForPlan` were simplified accordingly — they no
longer need to manually thread every unrelated field through just to
avoid erasing it.

### Webhook idempotency (`0005_webhook_idempotency.sql`)

Stripe explicitly documents at-least-once webhook delivery — the same
event can be (and, on any delivery hiccup, will be) sent more than once.
`subscriptions.last_webhook_event_id` records the most recently *applied*
event's id; `handleStripeWebhook` checks it before applying either event
type it handles and skips an exact replay. This is a single "most recent
event" slot, not a full processed-events log — sufficient to make
Stripe's documented retry behavior safe without a separate table. It
does **not** protect against out-of-order delivery of two genuinely
different events (e.g., an old event redelivered after a newer one was
already applied could still regress state) — a stated, deliberate scope
limit; full event-sequencing would need tracking each event's own
`created` timestamp per subscription, which is more than this pass's
"duplicate event handling" mandate called for.

### Test coverage added

- `services/api/src/__tests__/stripeProvider.test.ts` (new, 6 tests) —
  `createStripeProvider` against a local fake HTTP server (the same
  pattern `services/ai/__tests__/anthropic.test.ts` established): request
  shape (price/trial/metadata sent correctly, secret key only in the
  Authorization header), and every error mapping (401/403 → safe
  `provider-error` never leaking the raw Stripe body; 400 → `invalid-request`
  surfacing Stripe's own safe validation text; unreachable server →
  `provider-error`; a 2xx response missing a checkout URL → `provider-error`).
- `subscriptions.test.ts` gained a `createCheckoutSessionForPlan` describe
  block (new, 4 tests, mocking `../billing`'s `createCheckoutSession` the
  same way `quoteEmail.test.ts` already mocks `sendEmail`): missing-config
  throws the exact safe message; an unknown plan id is rejected *before*
  the billing provider is ever called; the price/businessId sent to the
  provider come only from server-side plan lookup and the session — there
  is no parameter through which a caller could substitute either; a
  provider error propagates as-is.
- `subscriptions.test.ts` gained 5 new tests for the trial-clock/upsert
  fixes above (repeated selection, plan switching, no duplicate row,
  genuine reactivation still grants a fresh trial, Stripe identifiers
  survive re-selection).
- `billingWebhooks.test.ts` gained 5 new tests: an unhandled event type is
  a safe no-op; a malformed (non-JSON) payload throws cleanly rather than
  crashing; exact-replay idempotency for both `checkout.session.completed`
  and `customer.subscription.updated`; a genuinely new event after an
  earlier one still applies (proving idempotency doesn't become
  "ignore everything after the first event").

### UI clarity (`PlanSelector.tsx`)

Added an explicit summary above the action buttons — which plan is
selected, its price, what the trial includes (full dashboard access, no
card, no charge), and what happens next (trial starts immediately;
checkout goes to Stripe first). No behavioral change; the underlying
actions were already correct.

## What was NOT changed

No payment UI was faked — "Enter card details now instead" still only
renders when `billingConfigured()` is true, and still goes through the
real Stripe Checkout code path. No final installation-fee price was
invented — `WEBSITE_INSTALLATION_FEE` is unchanged, still a labeled
placeholder. `BillingChargeStatus` remains `pending`/`paid`/`waived` —
no `"failed"` state was added, since no charge-attempt mechanism exists
yet to ever produce one (ADR 0016 already documents this as deliberately
out of scope); adding an unreachable status would be speculative, not
hardening. `markBillingChargeStatus` (the repository function that would
mark a charge paid) has no caller anywhere in the codebase — confirmed by
audit — so a charge can structurally never be marked paid without a
future, explicit integration.

## Consequences

- `subscriptions` gained one column (`last_webhook_event_id`),
  migration `0005`, additive and backfill-free (nullable, no existing row
  needs a value).
- `UpsertSubscriptionInput`'s optional fields changed from "always
  overwritten" to "patch semantics" — every existing caller
  (`startTrial`, `createCheckoutSessionForPlan`, `handleStripeWebhook`)
  was updated to rely on this rather than manually threading through
  unrelated fields, and all were simplified as a result.
- Known limitations, stated rather than hidden: no real Stripe checkout
  or webhook has been exercised against a live Stripe account in this
  environment (still true, as ADR 0016 stated); webhook idempotency
  guards exact replays only, not out-of-order distinct events; the
  subscription access gate still only covers the authenticated
  dashboard's `createQuote`, unchanged from ADR 0016.
