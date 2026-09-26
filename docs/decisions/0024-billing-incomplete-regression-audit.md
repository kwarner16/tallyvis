# 0024 — Billing "Incomplete" regression audit: two real gaps found and fixed

**Status:** Accepted (incident audit — not a new phase)

## Context

After ADR 0017/0018's hardening (commits `3b3f15d`/`bff3472`), the founder
reported the exact symptom those commits were supposed to have fixed:
Korr Window Cleaning's dashboard again showed "Status: Incomplete", and
choosing a plan produced "We couldn't start checkout. Please try again."
This ADR documents the full audit — Neon + the real Stripe test-mode
account (`acct_1UICRcBQynNZC2wg`, "TallyVis sandbox") — done before any
code was touched, per the incident brief's explicit freeze on destructive
actions (no cancel/create/manual-DB-edit/key-rotation/webhook-recreation).

## What was actually found in Stripe + Neon

The affected account is Korr Window Cleaning
(`business_92828cd6-7264-4c06-a6fd-56007e0931f8`, the founder's own
`krwarner16@gmail.com`), Stripe customer `cus_VK4nMPo3ZhBeVa`, subscription
`sub_1UJQe2BQynNZC2wgzSZnIdC0`.

- **Stripe's real subscription state at audit time:** `trialing`, `pro`
  plan, `canceled_at: null`, `cancel_at_period_end: false` — healthy.
- **Neon's stored state at audit time:** `status: trialing` (matching!),
  but `canceled_at` was a stale non-null timestamp from an EARLIER event —
  not `incomplete`, and not currently blocking access.
- **No business in the production database was at `status = 'incomplete'`
  at the time of this audit.** The reported "Incomplete" was a real,
  transient state (confirmed via the account's own webhook event history,
  fetched directly from Stripe) that had already self-corrected by the
  time this audit began — a normal consequence of webhook delivery
  latency between "Checkout completes" and "the subscription-lifecycle
  webhook lands," not a data corruption. The webhook endpoint
  (`we_1UJQEcBQynNZC2wgVmtJboGO`, enabled, correct URL/events, correct
  account) and environment variables (Vercel Production: all Stripe vars
  present, scoped to Production only, last touched together ~1 day before
  this audit, immediately following `3b3f15d`/`bff3472`) showed no drift.
  The disabled stray endpoint from the ORIGINAL incident
  (`we_1UJN5dBGRArqyRXrDAPdG441`, wrong account) is still correctly
  disabled — that specific regression did not recur.

Two real, reproducible gaps were found, both explaining real symptoms:

### Gap 1 — the duplicate-subscription guard's message was never made "safe" (root cause of "We couldn't start checkout")

`3b3f15d` added a guard in `createCheckoutSessionForPlan` that refuses to
start a second Checkout once a business already has a real Stripe
Customer with a non-terminal local status — exactly the right behavior
during the window between "Checkout completes" and "the webhook confirms
the real status," where the local row still reads `incomplete` even
though Stripe already has a live subscription. But
`apps/app/src/lib/subscriptionActions.ts`'s `SAFE_MESSAGE_PATTERN`
allowlist (from ADR 0017 — only a hand-written, deliberately-safe service
message reaches the browser, everything else becomes a generic fallback)
was never updated to include this new guard's message. The guard was
firing exactly as designed and refusing exactly correctly — but its own
actionable explanation ("use Manage billing instead") never reached the
browser; the founder saw only the generic `GENERIC_CHECKOUT_ERROR`
("We couldn't start checkout. Please try again."), making a correctly
working safeguard look like a mystery failure. **This is confirmed to be
exactly the Part 5 "expected scenario": Stripe has a live subscription,
the local guard correctly refuses a second one — the only bug is that the
UI never said so.**

### Gap 2 — `canceled_at` had no clearing path (found live in production data)

Unlike `cancel_at`/`cancel_at_period_end` (which ADR 0017 already gave a
CASE-based "explicitly clear on reactivation" path in
`upsertSubscription`), `canceled_at` only ever used a plain
`COALESCE($10, canceled_at)`. Once any event set it (e.g. a
schedule-then-immediately-reactivate sequence via the Customer Portal —
exactly what Korr Window Cleaning's own event history shows: an
`updated` event with `canceled_at` set, followed 42 seconds later by
another `updated` event with `canceled_at: null` reporting the real
reactivation), a later event reporting `canceled_at: null` could never
clear it — `COALESCE(NULL, existing)` always returns the stale value.
`status`/`cancel_at_period_end` recovered correctly; `canceled_at` alone
stayed stuck. Confirmed directly against the real Korr Window Cleaning
row: `last_webhook_event_id` correctly pointed at the LATEST real Stripe
event (which reports `canceled_at: null`), yet `canceled_at` still held
the earlier event's timestamp. This does not currently affect
entitlement (`hasProductAccess` only reads `status`/`trialEndsAt`), but
it is a genuine, live data-integrity bug in the same family ADR 0017
already fixed once for `cancel_at`.

## What was NOT found

- No evidence the webhook endpoint, account, or price ids drifted between
  environments — Production's Stripe env vars, the enabled webhook
  endpoint, and all four `STRIPE_PRICE_*` ids were verified to all belong
  to the same account (`acct_1UICRcBQynNZC2wg`) as the app's own
  configured `STRIPE_SECRET_KEY`.
- No evidence of same-`created`-timestamp event collisions actually
  causing a regression — the real event pair found (Gap 2) was 42 seconds
  apart, not simultaneous. `isStaleOrReplayed`'s strict `<` comparison
  (not `<=`) means two events sharing an identical `created` second are
  NOT mutually protected against reordering — a real, stated limitation,
  left unchanged per the incident brief's "do not change ordering logic
  without evidence."
- No stray/duplicate Stripe subscriptions were found for this business
  beyond the single legitimate one.

## Fix

1. **`SAFE_MESSAGE_PATTERN`** (`apps/app/src/lib/subscriptionActions.ts`)
   now includes the duplicate-subscription guard's message, so its real,
   actionable explanation reaches the browser instead of the generic
   fallback.
2. **`canceled_at` clearing** — `UpsertSubscriptionInput` gained
   `clearCanceledAt`, and `upsertSubscription`'s UPDATE now uses the same
   CASE-based clear-on-explicit-signal pattern `cancel_at` already used.
   `billingWebhooks.ts`'s per-event field mapping was extracted into a
   shared, pure `buildSubscriptionPatchFromStripe()` (also used by the new
   reconciliation path below) so both the webhook path and the
   reconciliation path apply the identical clearing rule.
3. **Bounded, opportunistic Stripe reconciliation for the one genuinely
   ambiguous case** — `services/subscriptions.ts`'s new
   `reconcileSubscriptionFromStripe()` fetches the real Stripe subscription
   (`BillingProvider.retrieveSubscription`, new) and self-heals the local
   row, but ONLY when `status === "incomplete"` AND a
   `providerSubscriptionId` is already on file (i.e. Checkout genuinely
   completed but no lifecycle webhook has landed yet) — a healthy
   trialing/active/canceled/expired row, or one with no Stripe
   subscription yet, never reaches Stripe here. This directly closes "a
   valid Stripe subscription must not stay `incomplete` forever because of
   a missed webhook" without adding Stripe traffic to the hot entitlement
   path (`hasProductAccess`/`createQuote`) — deliberately NOT wired into
   `getSubscription`, which the entitlement gate and every dashboard page
   call on every request. It's wired into exactly two deliberate,
   human-initiated moments instead: `createCheckoutSessionForPlan`'s guard
   (before deciding whether to block) and a new `getSubscriptionReconciled`
   used only by the billing dashboard page. Fails safe — any Stripe error
   during reconciliation is logged and swallowed, never thrown, falling
   back to the stale local state.

## What was deliberately NOT changed

- The webhook endpoint, `STRIPE_WEBHOOK_SECRET`, Stripe account, or any
  Vercel environment variable — none were found to be drifted or wrong.
- `isStaleOrReplayed`'s ordering comparison — no evidence of a same-second
  collision causing a real regression; changing it without evidence would
  violate the incident brief's own instruction.
- No subscriptions were created, canceled, or manually edited in Neon or
  Stripe as part of this fix. The only Stripe API calls made during the
  audit were read-only (`GET /v1/account`, `/v1/prices/{id}`,
  `/v1/subscriptions/{id}`, `/v1/webhook_endpoints`,
  `/v1/events` for this one customer's own events).

## Consequences

- `subscriptions` repository gains no new column — `clearCanceledAt` is a
  request-shape field, not a stored one.
- `BillingProvider` gained one new method (`retrieveSubscription`),
  implemented via a plain `GET` (the provider's `stripeRequest` helper now
  supports `GET` in addition to `POST`/`DELETE`).
- 8 new tests: 1 `canceled_at` reactivation-clearing test
  (billingWebhooks), 5 reconciliation-boundary tests + 2
  `getSubscriptionReconciled` tests (subscriptions) — 548 total tests
  across the whole workspace, all passing, alongside a clean
  `lint`/`typecheck`/`build`. `pnpm audit` shows 7 pre-existing
  dev-tooling advisories (`vite`/`vitest`/`launch-editor`, all
  build/test-time only) unrelated to this change.
