# 0039 — Embed logo fix, admin signup notifications, and business feedback

## Status

Accepted. Implemented as part of the same pre-launch production hardening
pass as ADR 0038 (customer quote photo storage).

## Context

Three more real issues came out of Kyle's manual testing pass:

1. **Embedded estimator's logo broke out into the Tallyvis demo.** Clicking
   the "Tallyvis" wordmark while a business's estimator was embedded on
   their own website navigated into `/estimate` — the bare, direct wizard's
   welcome screen, with generic "This is a prototype experience... no
   request is sent to a real business" copy and no sign the business was
   ever involved.
2. **No notification when a new business signs up.** Kyle had no way to
   know, without checking the admin dashboard himself, when someone
   created a new TallyVis trial.
3. **No easy way for a business to report a bug or send feedback.**

## Decisions

### 1. Embed logo

Root cause: `StepShell.tsx`'s `TallyvisWordmark`, in its `embedded` branch,
was still a plain internal `Link href="/estimate"` — a holdover from
before the wordmark's non-embedded behavior was changed to link out to
the marketing site. `EstimatorProvider` isn't remounted by this
same-layout client-side navigation, so the embed's tenant identity
(`embedId`) technically survived the click — the bug was never a second
tenant-isolation leak like ADR 0026's. It was that the customer's screen
got yanked out of the business's branded, in-progress flow into
`/estimate/page.tsx`'s generic, unbranded, demo-labeled welcome screen.

Fix: inside an embed, the wordmark is now a plain, non-interactive
`<span>` — not a link, not a button, nothing attached to it can navigate
anywhere. This is the literal "make the logo/wordmark non-navigational
inside embedded mode" option the audit called out as the preferred,
simplest fix, and it's what was implemented — no alternative (e.g. "open
somewhere in a new tab") was needed. The decision is exposed as a tiny,
pure, unit-tested predicate (`apps/app/src/components/wordmarkNavigation.ts`'s
`isWordmarkNavigable`) specifically so this exact invariant has a direct
regression test — the existing `EstimatorContext.test.ts` coverage for
`shouldConsiderCachedEmbedId`/`shouldBlockEstimator` (the
cached-embed-id-survives-navigation incidents, ADR 0026) was already
correct and untouched by this fix; it covers a different mechanism
(sessionStorage-cached tenant identity across a FRESH mount) than this
one (a same-session client-side navigation target).

### 2. Admin signup notification

The one authoritative lifecycle event chosen: **a `businesses` row
actually committing**, which happens in exactly two places —
`services/auth.ts`'s `signUp` (password signup) and
`services/googleAuth.ts`'s `createAccountFromGoogle` (fresh Google
signup). Both already wrap business+pricing-config+user+session creation
in a single transaction; the notification call was added immediately
after each transaction resolves successfully, using the business row
that transaction actually committed — never from inside the transaction
(a later step in the same transaction failing and rolling back must
never leave an admin notification already sent for a business that no
longer exists) and never on any path that throws.

This is why "Google onboarding completion" is explicitly NOT the hook
point: `completeOnboarding` (the dashboard step that collects a real
business name for a Google signup, clearing `needsOnboarding`) only ever
UPDATEs the business row `createAccountFromGoogle` already created — it
never creates one, so it can't duplicate the signal, and a returning
Google user (`signInWithGoogle`'s `kind: "login"`/`"linked"` outcomes)
never reaches `createAccountFromGoogle` at all. A retried/duplicate
signup attempt for the same email hits the `users.email`/Google-identity
uniqueness constraints and throws before ever reaching the notification
call, so a flaky client retry can't double-notify either.

Implementation: `services/api/src/services/adminNotifications.ts`'s
`notifyAdminOfNewSignup`, mirroring the existing `EmailProvider`/
`SmsProvider` fire-and-forget pattern (`sendNewQuoteSmsAlert`'s
`{ finished: Promise<void> }` shape exactly) — every send is caught and
logged, never rethrown, and the call sites in `signUp`/
`createAccountFromGoogle` are themselves wrapped in a defensive
try/catch OUTSIDE the transaction's own try/catch, specifically so a
problem in the notification call (synchronous or not) can never be
mistaken for the signup itself having failed and reported back to the
customer as such — the account is already real and committed by that
point. New env vars: `ADMIN_NOTIFICATION_EMAIL` (required for the email
to send at all — unset logs a warning and skips it, never blocks
signup), and an optional `ADMIN_SIGNUP_SMS_ENABLED`/
`ADMIN_NOTIFICATION_PHONE` pair reusing the existing Twilio/`SmsProvider`
infrastructure for a concise SMS alert — to Kyle's own number, never a
customer's, never gated on any customer's SMS consent (none of that
applies here). The email deliberately never fabricates an owner name
(none is collected at signup) or a plan/trial status (plan selection
happens later, in onboarding) — it says "Plan/trial: not yet selected"
rather than guessing.

### 3. Business feedback

An intentionally small addition: a `feedback` table (migration
`0014_feedback.sql`), `services/api/src/services/feedback.ts`'s
`submitFeedback`/`listFeedbackAdmin`, a `/dashboard/feedback` form (type,
message, optional "contact me" checkbox), and a simple `/admin/feedback`
list (type, business, user, message preview, date, expandable for the
full submission) added to the existing admin dashboard — no
disproportionate architecture change was needed, so the "email
notification + DB persistence is acceptable for V1" fallback the audit
allowed for wasn't needed either. No status/workflow column — Kyle reads
and follows up directly.

`business_id`/`user_id` are always derived from the submitting session
(`requireContext()` → `AuthSession`), never from the form — `submitFeedback`'s
own input type has no such fields for a client to even attempt to supply.
Persistence happens before the admin notification is even attempted
("persist first, notify second" exactly as specified), and — same defensive
pattern as the signup notification — a notification failure is caught
outside any transaction/control flow that could make it look like the
submission itself failed; the row is already committed by that point.

## Consequences

- `StepShell.tsx` no longer imports `next/link` at all (`Link`'s only use
  was the now-removed embedded-link branch).
- New env vars (documented in `.env.example`):
  `ADMIN_NOTIFICATION_EMAIL`, `ADMIN_SIGNUP_SMS_ENABLED`,
  `ADMIN_NOTIFICATION_PHONE`. None are required for the app to run;
  omitting them just means the admin notifications don't fire (logged,
  never fatal).
- `services/api/src/notifications/htmlEscape.ts` is a new small shared
  module — `quoteEmail.ts`'s previously-private `escapeHtml` helper,
  factored out once `adminNotifications.ts` needed the identical thing
  rather than duplicating it a second (and, for feedback, third) time.
- Migration `0014_feedback.sql` adds one new table. See "External
  configuration Kyle must perform" in the final report for the exact
  command to apply it to the real production database — this pass does
  NOT apply it there itself.
- What was and wasn't verified: all three fixes are covered by real
  automated tests (service-level for the notification/feedback logic,
  a unit-tested pure predicate for the wordmark fix) against this
  environment's real Postgres test database. No real email/SMS send to
  Kyle's actual inbox/phone was exercised (this environment has no
  `ADMIN_NOTIFICATION_EMAIL`/Twilio credentials configured, and none were
  added) — that verification is part of Kyle's own post-deploy
  acceptance testing, same as every other notification path in this
  codebase.
