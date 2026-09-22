# 0019 — Account/settings features: scheduled cancellation, distributed idempotency, Google auth foundation

**Status:** Implemented (V1 account/product features phase, following the Stripe V1 hardening pass in ADR 0018). Google Sign-In's code, tests, and policy are complete but not yet exercised against a real Google Cloud OAuth client — see this doc's final section.

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

## Secure account deletion

`services/accountDeletion.ts`'s `deleteAccount(db, session)` is
Stripe-first, always: if the business has a non-canceled subscription, its
Stripe subscription is canceled immediately (never scheduled — a deletion
is not a "keep access until period end" request) *before* any local row is
touched. If that Stripe call fails, the function throws
`AccountDeletionError` and makes zero local changes — a business is never
left in the state of "deleted here, still billing in Stripe." Only after
Stripe confirms cancellation (or there was nothing to cancel) does the
local cascade run, inside one transaction
(`repositories/accountDeletion.ts`'s `deleteAllBusinessData`, enumerated
against every migration file's `CREATE TABLE`/`business_id`/`user_id`
columns so nothing is missed), followed by revoking every session for the
user. The Stripe *Customer* object itself is never deleted — only the
subscription — since Stripe is this system's accounting record of what was
actually billed, and erasing it would be a bigger, unrelated decision than
"a business stopped using Tallyvis."

An in-process `Set`-based guard (the same pattern as the Checkout
concurrency guard) rejects a second concurrent deletion attempt for the
same business rather than racing two cascades against each other. The
dashboard's Danger Zone (`DangerZoneClient.tsx`) requires typing `DELETE`
verbatim before the form can submit, and its copy states plainly that
Stripe's own billing history is not erased — deletion here is "your
Tallyvis data and access," not "every trace anywhere."

## Password-reset email delivery and enumeration hardening

`requestPasswordReset` now sends a real, Tallyvis-branded HTML email
(`buildPasswordResetHtml`) through the `EmailProvider` abstraction Phase 14
already introduced (`dev` console provider locally, `resend` in
production) instead of only logging a link. Doing this surfaced two
enumeration/reliability gaps in the *existing* Phase 14 code, both fixed
here rather than carried forward:

1. **Timing** — the found-account path used to `await` the email send (a
   real network round-trip once a real provider is configured, dominant
   and variable), while the not-found path returned instantly. Fixed by
   never awaiting the send (fire-and-log:
   `void sendEmail(...).catch(err => console.error(...))`) and by doing
   the same shape of local work (generate + hash a token, then discard it)
   on the not-found path, so both branches' response times are dominated
   by the same fast local operations rather than by which one happened to
   await a network call.
2. **Failure behavior** — a real send failure used to reject and propagate
   to the caller, producing a visibly different (error) outcome for a real
   account with a broken email provider than for a nonexistent email
   (silent success) — a much bigger enumeration signal than timing, and
   also a plain reliability bug given the user-facing response was always
   going to be the same generic message regardless of delivery outcome.
   Fixed by the same fire-and-log change.

## Google OAuth/OIDC — flow, verification, and account-linking policy

Building on this ADR's earlier schema section, the flow itself:

- **`auth/googleOAuth.ts`** — low-level OIDC mechanics only, no session/
  account opinions. `generatePkcePair()` (RFC 7636, S256 method only) and
  `generateRandomToken()` (`state`/`nonce`) use `node:crypto`'s
  `randomBytes` directly — no hand-rolled cryptography beyond generating
  random bytes and computing a SHA-256 digest, both delegated to Node's
  standard library. `buildGoogleAuthorizationUrl` requests only `openid
  email` scope — deliberately not `profile`, since nothing here has a use
  for a Google-supplied name and any additional scope is additional
  trusted-but-unverified surface. `exchangeCodeForIdToken` POSTs the
  authorization code plus the PKCE verifier to Google's token endpoint
  (endpoint overridable for tests only). `verifyGoogleIdToken` delegates
  signature verification entirely to `jose`'s `jwtVerify` against Google's
  real remote JWKS (`createRemoteJWKSet`, cached module-level) or an
  injected local JWKS in tests, and separately checks issuer, audience
  (this app's own client id — never trust a token issued for a different
  client), and nonce match; any failure throws `GoogleAuthError` with an
  already-safe, generic message. `jose` (v6) was added as the one new
  dependency this phase explicitly authorized, specifically so that no
  JWT/JWKS logic is hand-written here.
- **`services/googleAuth.ts`** — the account-linking policy, which is
  where this feature is actually security-critical (`googleOAuth.ts` only
  proves "this really is Google," this file decides what that's allowed to
  do to an account). The rule: an OAuth identity is only ever attached to
  an account when the caller can already prove some other form of control
  over it. There are exactly two accepted proofs — (1) the identity is
  already linked (a returning Google user logs in, no further check), or
  (2) the caller already holds a valid Tallyvis session at the moment the
  callback lands (an explicit "Connect Google" click from Settings, while
  authenticated by whatever means got them there). A bare email match is
  never accepted as proof — an attacker who pre-registers `victim@example.com`
  with a password and later "signs in with Google" as the real
  `victim@gmail.com` is rejected with "an account already exists for this
  email," and directed to log in normally and link from Settings, never
  silently linked or logged in. `signInWithGoogle`'s five outcomes:
  `login` (existing identity), `signup` (brand-new business + Google-only
  user, `password_hash: null`, an auto-derived placeholder business name,
  ending at `/dashboard` like a password signup — not a separate
  onboarding path), `linked` (identity attached to the current session's
  account), and two rejection paths (`GoogleSignInError` for
  policy/collision reasons, unverified email rejected in every branch that
  can create or attach an identity).
- **Route handlers** (`apps/app/src/app/api/auth/google/{start,callback}`)
  — one shared pair for sign-up, login, and linking, since Google's own
  flow doesn't distinguish them; the distinction is made from whether
  `getOptionalSession()` resolves a session at callback time, decided
  *before* touching anything Google-supplied. `state`/`nonce`/PKCE
  verifier are held in short-lived (10-minute) httpOnly cookies, cleared
  unconditionally on the callback's first branch. A collision/linking
  error redirects back to `/dashboard/settings` (already authenticated) or
  `/login` (fresh attempt) with an `?error=` query param — the classes'
  own messages are already safe, generic, user-facing text, so they pass
  through as-is; a few route-level failure codes (missing cookies, denied
  consent, not configured) map to friendlier copy client-side.
- Both `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are read directly in
  apps/app's route handlers (matching where `STRIPE_WEBHOOK_SECRET` is
  read, not hidden behind services/api) and are optional — unset, the
  "Continue with Google" buttons safely redirect back with a
  "not configured" message rather than erroring.
- Tested with `jose`'s `createLocalJWKSet` against a locally generated
  keypair (`googleOAuth.test.ts`) — signature, issuer, audience, expiry,
  and nonce are all exercised against real cryptographic verification with
  no network access or real Google credentials, mirroring the "fake the
  network dependency locally" pattern `stripeProvider.test.ts` already
  established for HTTP providers. Account-linking policy
  (`googleAuth.test.ts`) covers signup, login, the email-collision
  rejection, linking from an authenticated session, rejecting a link to an
  identity already claimed by a different account, and business isolation
  between distinct Google identities.

**External configuration required before any real end-to-end test:** a
Google Cloud OAuth 2.0 Client ID (type: Web application) with an
Authorized redirect URI matching `${NEXT_PUBLIC_APP_URL}/api/auth/google/callback`
for each environment — this was not created in this environment, so no
live Google sign-in has been exercised, only the fully offline-testable
mechanics and policy logic above.
