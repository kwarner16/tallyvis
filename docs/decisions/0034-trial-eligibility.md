# 0034 — One free trial per business, ever (trial-abuse fix)

**Status:** Accepted

## Context

A launch-blocking abuse loophole was found and reported in production: a
business could start a 30-day free trial, cancel it, return to the
dashboard, and start another 30-day free trial — repeated indefinitely for
unlimited free access.

## What was found (audited before writing any code)

`createCheckoutSessionForPlan` (`services/api/src/services/subscriptions.ts`)
is the one production path that creates a Stripe Checkout Session for a
new or returning subscriber. It unconditionally passed
`trialDays: getTrialDaysForNewSubscription()` to Stripe on every call —
the only guard against a second checkout
(`existing?.billingCustomerId && existing.status !== "canceled" &&
existing.status !== "expired"`) exists to prevent a SECOND *concurrent/
active* subscription, not to prevent a second *trial*. Once a business
canceled (status becomes `"canceled"` via the webhook), that guard no
longer applied, and the very next Checkout Session Stripe created was
handed a fresh trial period exactly as if the business were new.
Eligibility was, in effect, being inferred from current subscription
status — exactly what the report asked us not to rely on.

`subscriptions.trial_started_at` already existed and is never cleared
once set (COALESCE-preserve in `upsertSubscription`), but it reflects the
**most recent** trial's start date — a second trial would have
overwritten it with the new date, making it unsuitable on its own as a
permanent "has this business ever had a trial" marker without risking a
future well-intentioned "fix" (e.g. "let's make this reflect the current
trial properly") silently reintroducing the loophole.

## What was built

**`subscriptions.trial_used_at`** (migration `0011_trial_eligibility.sql`) —
a dedicated, permanent marker, deliberately separate from
`trial_started_at`. Set exactly once, the first time a business is
granted a trial, by `createCheckoutSessionForPlan` itself (synchronously,
right after Stripe confirms the Checkout Session was created — not left
to depend on a webhook that could be delayed or lost). Never cleared or
overwritten again by any code path, regardless of cancellation,
subscription deletion (`customer.subscription.deleted`), or
resubscription — enforced by the same COALESCE-preserve pattern every
other durable-history column on this table already uses.

**`isTrialEligible(subscription)`** (`services/subscriptions.ts`, exported
from `services/api`) — the one function that decides eligibility:
`!subscription?.trialUsedAt`. Deliberately reads nothing about current
`status`. Used in exactly two places:
- `createCheckoutSessionForPlan`: re-derives this business's OWN
  persisted subscription row fresh from the database on every single
  call (never from caller input — the function's signature has no
  trial-related parameter at all) and passes `trialDays: grantTrial ?
  getTrialDaysForNewSubscription() : undefined` to Stripe accordingly.
  This is the actual enforcement point; nothing else in the request path
  can influence whether Stripe grants a trial.
- The onboarding page (`apps/app/src/app/dashboard/onboarding/page.tsx`):
  purely cosmetic — computes the same check to decide what copy/button
  label to show ("Start a 30-day free trial" vs. "Subscribe now"). Shown
  for UX honesty only; the authoritative check re-runs server-side inside
  `createCheckoutSessionForPlan` regardless of what the page displayed; a
  stale page, a tampered request, or a client that skips the UI entirely
  all get the same correct, server-decided outcome.

**Backfill**: done directly inside the migration, not a separate script —
`UPDATE subscriptions SET trial_used_at = trial_started_at WHERE
trial_started_at IS NOT NULL AND trial_used_at IS NULL`. Every existing
production business that has ever recorded a trial start (even if now
canceled/expired, even if its subscription was later deleted) is exact,
since `trial_started_at` itself has never been cleared once set.

## What was deliberately not built

No change to `startTrial` (the DB-only, no-card trial helper) — it is not
reachable from any production UI (see its own existing comment;
`createCheckoutSessionForPlan` is the one real production path) and is
retained purely as test/internal fixture infrastructure; enforcing
eligibility there too would have meant touching a large number of
unrelated existing tests that deliberately use it to set up arbitrary
trialing fixtures, for no production benefit. No change to the Stripe
webhook handler (`billingWebhooks.ts`) — `trial_used_at` is stamped at
Checkout-creation time, synchronously, so the webhook never needs to know
about trial eligibility at all; it continues to only reconcile
status/period/cancellation fields exactly as before. No new table, no
history log of every trial ever granted — one timestamp per business is
sufficient for "ever had a trial, yes or no," which is all the
requirement asks for.

## Verification

5 new tests in `services/api/src/__tests__/subscriptions.test.ts`
(`describe("trial eligibility — one free trial per business, ever")`)
covering: a brand-new business receiving its trial; a canceled trial
unable to receive another; a real, signature-verified
`customer.subscription.deleted` webhook unable to restore eligibility; a
full realistic trialing → active → canceled → resubscribe lifecycle
still correctly denied a second trial (while still correctly reusing the
existing Stripe Customer); and confirmation that no caller-reachable
input can bypass the check. One pre-existing test (the promo/non-promo
trial-length date-boundary test) was updated to use two separate
businesses instead of reusing one for both date scenarios, since reusing
one business for a second trial attempt is now correctly refused — that
test's actual subject (the Dec 31/Jan 1 cutover) is unaffected and still
fully covered.

`pnpm --filter @tallyvis/api test`: 432/432 passing (5 new). Root
`pnpm typecheck`/`pnpm lint`: clean. Both app builds: clean.
