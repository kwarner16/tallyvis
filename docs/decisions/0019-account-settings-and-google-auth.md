# 0019 — Account/settings features: scheduled cancellation, distributed idempotency, Google auth foundation

**Status:** In progress (V1 account/product features phase, following the Stripe V1 hardening pass in ADR 0018)

## Context

With Stripe V1 hardened and audited, this phase adds the final four V1
account/product features before feature freeze: subscription
cancellation/billing management UX, secure account deletion, real
password-reset email delivery via Resend, and Google Sign-In — plus three
hardening items the engineering audit surfaced as directly related:
distributed-safe Stripe idempotency, persisted/displayed scheduled
cancellation state, and the password-reset timing-enumeration gap.

SQLite remains local-development-only for this phase; every schema change
here is written to translate cleanly to the Postgres migration that
follows.

## Scheduled cancellation state

Stripe's Subscription object distinguishes "scheduled to cancel at period
end" (`cancel_at_period_end: true`, `cancel_at: <timestamp>`) from
"actually canceled" (`status: canceled`) — the previous schema only
tracked the latter. Added `subscriptions.cancel_at_period_end` (integer
boolean, default 0) and `subscriptions.cancel_at` (nullable timestamp) in
migration `0007`.

These two fields deliberately do NOT use the same COALESCE-partial-patch
semantics as most of `upsertSubscription`'s other optional fields: a
portal-driven *reactivation* (Stripe reports `cancel_at_period_end` back
to `false`) must actually clear `cancel_at`, which a plain
`COALESCE(?, cancel_at)` can never do (`COALESCE(NULL, x)` returns `x`,
not `NULL`). The repository uses a `CASE WHEN ? = 0 THEN NULL ELSE
COALESCE(?, cancel_at) END` instead — the boolean parameter doubles as
both the column's own COALESCE source and the CASE condition. Callers
with no opinion (`startTrial`, a fresh `createCheckoutSessionForPlan`)
simply omit both fields and the existing state is preserved; only
`billingWebhooks.ts`'s `applyStripeSubscription` — which always knows
Stripe's current truth whenever the payload includes the property — ever
sets them explicitly, using `"cancel_at_period_end" in stripeSub` (not
`Boolean(...)`) to distinguish a genuinely absent property (preserve) from
an explicit `false` (clear). A `customer.subscription.deleted` event
forces both to `false`/cleared regardless of the payload, since actual
cancellation supersedes any prior scheduling.

Scheduling a cancellation never touches `status` — a business stays
`trialing`/`active` (full product access) until `cancel_at` actually
passes and Stripe sends the real `.deleted` event. The dashboard surfaces
the scheduled state as a distinct amber "· Canceling" badge plus the exact
end date, without implying access has already changed.

## Distributed-safe Stripe idempotency

The existing in-process `Set`-based guard (added during the engineering
audit, see ADR 0018-adjacent commit) fully prevents a concurrent second
request from ever reaching Stripe — but it's invisible across server
processes, so it stops helping the moment this app runs as more than one
instance. Added a required `idempotencyKey` field to
`CreateCheckoutSessionInput`, sent as Stripe's own `Idempotency-Key`
header on every Checkout Session creation call (subscription and
installation).

Key lifecycle: `checkoutIdempotencyKey(kind, businessId, scopeVersion)`
derives a key from the relevant row's own `updatedAt` — the subscription's
for a plan checkout, the pending charge's for an installation checkout.
Two requests landing before either has written back (a double-click, two
tabs, a network retry) read the same `updatedAt` and produce the same key,
so Stripe returns its original result for the second instead of creating
a duplicate object. A genuinely later attempt — after a webhook has
updated the row — naturally derives a different key, so a business is
never permanently blocked from retrying; even if `updatedAt` somehow never
changed, Stripe itself expires an idempotency key's dedup record after 24
hours, comfortably longer than a Checkout Session's own default expiry.
The in-process guard is kept as defense-in-depth (instant, free, zero
Stripe calls) alongside the key, not replaced by it.

## Auth identity model for Google Sign-In (schema only, this pass)

`users.password_hash` was `NOT NULL`, which cannot represent a Google-only
account without a fake placeholder hash — explicitly ruled out. SQLite has
no `ALTER TABLE ... ALTER COLUMN`, so relaxing the constraint required the
standard rebuild pattern (migration `0008`): create `users_new` with the
relaxed shape, copy every row verbatim (ids unchanged, so `sessions.user_id`
and future `auth_identities.user_id` still resolve correctly by value),
drop the old table, rename.

**A real bug this surfaced, not just a hypothetical:** every test in this
suite runs migrations against a brand-new, empty `:memory:` database,
where `users`/`sessions` have zero rows by the time `0008` runs — that
setup could never catch what actually happens against a populated
database. With `PRAGMA foreign_keys = ON` (set on every real connection)
and at least one existing `sessions` row, dropping the old `users` table
failed outright with "FOREIGN KEY constraint failed" — verified by running
the migration against this repo's own real dev database before the fix,
not assumed. `PRAGMA foreign_keys` cannot be toggled inside a transaction,
so `db/migrate.ts`'s runner now toggles it off/on around each migration
file (outside the file's own BEGIN/COMMIT) and runs `PRAGMA
foreign_key_check` afterward, failing loudly if anything was left
inconsistent rather than trusting a rebuild silently succeeded. A
permanent regression test (`migrations.test.ts`) now seeds a
pre-`0008`-shaped database with real user/session rows and asserts both
survive the rebuild with zero foreign-key violations — this is what
would have caught the bug automatically, and would catch a regression in
either `migrate.ts` or a future rebuild-style migration.

`auth_identities` (also migration `0008`): one row per linked external
identity, not per-provider nullable columns on `users` — `user_id`,
`provider`, `provider_account_id` (the provider's own stable subject
identifier, e.g. Google's `sub` claim — never an email, which can change
and is never a trustworthy long-lived key), a denormalized `email` snapshot
for display only (never used to look up or match an identity), and
`created_at`. Unique on `(provider, provider_account_id)`. A user may have
a password, one or more linked identities, or both — nothing here forces
an either/or.

The actual Google OAuth/OIDC flow, account-linking policy enforcement, and
UI are separate, later steps in this same phase; this section documents
only the schema foundation landed so far.
