# 0037 — Provider-status reconciliation CLI

**Status:** Accepted

## Context

ADR 0036 added `subscriptions.provider_status` (Stripe's raw billing
status, separate from TallyVis's own entitlement `status`) but
deliberately did not backfill it for existing rows — TallyVis never
recorded Stripe's historical raw status, so there was nothing honest to
fill it in with. That ADR's "Historical rows" section flagged this as a
real, temporary limitation: until a row's next webhook or the existing
`reconcileSubscriptionFromStripe` self-heal path happens to touch it,
`provider_status` stays `NULL`, and `isSubscriptionPastDue` treats that
optimistically as "not past due."

This ADR builds the explicit, founder-triggered tool to close that gap
immediately for every existing subscription, without waiting for the next
webhook — the thing ADR 0036 said would need "an explicitly approved
one-off reconciliation script" before it could be built.

## Design

Split into two pieces, mirroring `billingWebhooks.ts`'s existing
"pure computation vs. I/O wrapper" pattern:

- **`services/providerStatusReconciliation.ts`'s `reconcileProviderStatuses(db, { apply })`**
  — the actual logic, directly unit-testable (mocks `retrieveSubscription`
  the same way `subscriptions.test.ts`'s existing reconciliation test
  does). For every subscription with a real `providerSubscriptionId`:
  fetches Stripe's current `status` via the existing
  `services/api/src/billing/index.ts`'s `retrieveSubscription` (the same
  billing-provider abstraction and `STRIPE_SECRET_KEY` resolution every
  other Stripe call in this codebase already uses — nothing new was
  added to the Stripe client), compares it to the stored
  `provider_status`, and — only when they differ, and only when
  `apply: true` — writes it via the new, single-column
  `repositories/subscriptions.ts#setProviderStatus`. A subscription with
  no `providerSubscriptionId` at all is skipped before Stripe is ever
  contacted. A Stripe error for one subscription is caught and recorded
  in `failures`; every other subscription is still processed.
- **`db/reconcileProviderStatus.ts`** — the thin CLI wrapper (same shape
  as `grantAdmin.ts`/`waiveInstallation.ts`): parses `--apply` off
  `process.argv`, calls the function above, prints a diff-style line per
  change and a summary. Never imported by anything else in the app, never
  run from a migration or at startup — a human runs it on purpose.

### Why not reuse `upsertSubscription`/`reconcileSubscriptionFromStripe`?

`reconcileSubscriptionFromStripe` (existing) calls
`buildSubscriptionPatchFromStripe` and `upsertSubscription`, which
together also resolve/write `plan_id` from the Stripe Price, and write
trial dates, cancellation dates, and `cancel_at_period_end` — exactly the
fields this task said NOT to touch ("Only synchronize the current Stripe
subscription status into provider_status"). `upsertSubscription` also
requires `status` as a mandatory, unconditionally-written parameter
(never COALESCE-preserved), so reusing it here would require carefully
re-passing the existing `status` back in on every call — correct, but
fragile and easy to get wrong in a future edit. `setProviderStatus` is a
new, single-column `UPDATE subscriptions SET provider_status = $1 WHERE
business_id = $2` — it is structurally impossible for this path to ever
write `status`, `plan_id`, or anything else, which is a stronger guarantee
than "we were careful to pass the old value back."

## Safety boundaries — what this CLI explicitly cannot do

- Cannot alter `subscriptions.status` (entitlement) — never calls
  anything that writes that column.
- Cannot alter `plan_id`, trial dates, cancellation dates, or any other
  subscription column — `setProviderStatus` only ever sets one column.
- Cannot modify `@tallyvis/config`'s `PLANS` or any plan definition —
  never reads or writes plan pricing/features.
- Cannot modify any Stripe subscription — only ever calls
  `retrieveSubscription` (a read), never `cancelSubscriptionImmediately`
  or any mutating Stripe endpoint.
- Cannot run automatically — not imported by `getDb()`, any migration, any
  webhook handler, or any Next.js route. The only way to invoke it is the
  explicit `pnpm --filter @tallyvis/api reconcile-provider-status`
  command, and even then it only WRITES with the additional explicit
  `--apply` flag.
- Cannot corrupt unrelated rows from one subscription's Stripe failure —
  each subscription is fetched/written independently; a failure is
  recorded and the loop continues.

## Dry run vs. apply

Default (no flag) is dry run — computes and prints every would-be change,
writes nothing. `--apply` is the one, explicit, intentional flag required
to write anything; there is no way to apply changes by accident. Safe to
run repeatedly: a subscription whose `provider_status` already matches
Stripe's current value is reported as "already up to date" and neither
re-written nor listed as a change.

## Testing

`services/api/src/__tests__/providerStatusReconciliation.test.ts` (new, 9
tests): skips rows with no Stripe subscription id (and never contacts
Stripe for them); dry run computes but never writes; apply mode writes
exactly the reported change; `status`/`plan_id`/`hasProductAccess` are
provably unaffected regardless of what Stripe reports; idempotent repeat
run reports zero further changes; one subscription's simulated Stripe
failure doesn't block or corrupt a second, healthy subscription's update;
and three dedicated "admin metrics after reconciliation" tests confirming
a legacy NULL row moves from Active MRR into Past-Due MRR exposure once
reconciled to `past_due`, a confirmed-active reconciliation stays in
Active MRR, and canceled/trialing/incomplete subscriptions never
contribute to either MRR bucket after reconciliation.

`pnpm --filter @tallyvis/api test`: 470/470 passing. Root
`typecheck`/`lint`/`build`: clean.
