# 0033 — First-paying-customer launch readiness audit

**Status:** Accepted

## Context

Before accepting payment from TallyVis's first real window-cleaning
business, a full launch-readiness audit was requested: trace the actual
code paths for the complete customer journey (signup → plan → Stripe
checkout → onboarding → pricing config → embed install → a real customer
submitting photos → AI analysis → business review/approval → customer
email → customer quote response → business follow-up), fix genuine
blockers, add a customer-facing installation guide, and leave a precise
Stripe Live cutover checklist — without redesigning anything or adding
speculative features.

## What was audited

Auth (sessions, cookies, password reset, `requireContext()` on every
dashboard page/action), onboarding (business creation, Stripe Checkout as
the one production plan-selection path — see
docs/decisions/0018-stripe-v1-hardening.md, which this audit confirmed
still holds), Stripe/billing (`services/api/src/billing/*`,
`services/subscriptions.ts`, `services/billingWebhooks.ts` — already
environment-agnostic: every Price id and credential is read from env vars,
never hardcoded to test or live mode), the public/embedded estimator
(`publicActions.ts` — confirmed the ADR 0027 fix holds: no fallback to an
arbitrary real business, the direct un-embedded `/estimate` wizard is
still a true no-database-write demo), the dashboard (quote list/detail,
approval, customers, job outcomes, pricing config, settings, embed
install), the customer quote flow (`quoteSharing.ts` — share-token
authorization, tested cross-tenant isolation), email (`quoteEmail.ts`,
`notifications/index.ts`), security (auth boundaries, cross-business data
access, upload limits, debug logging, dev-only shortcuts), the database
(migration manifest vs. files on disk), and the estimator's AI-confidence/
human-review gate (`determineInitialQuoteStatus`,
`services/ai`'s own "AI output never supplies a price" test).

Most of this was found to already be well-hardened from prior phases
(0011, 0012, 0018, 0020, 0021, 0026, 0027 in particular). This ADR
documents what was NOT already solid, and what was done about it.

## What was found and fixed

**BLOCKER — real Twilio credentials were added to Vercel production
roughly an hour before this audit**, alongside `SMS_PROVIDER`, with no
code-level safeguard against them actually being used while TallyVis's
A2P 10DLC campaign is still unapproved. Previously, `resolveSmsProvider()`
(`notifications/sms/index.ts`) would send a real message through Twilio
the moment `SMS_PROVIDER=twilio` and valid credentials were both present
— with no separate signal for "the campaign is actually approved."
**Fixed:** added `SMS_A2P_APPROVED`, a dedicated kill switch checked
before Twilio credentials are ever read. A real send through Twilio is
now refused (a safe, logged `NotificationError`, swallowed by every
caller exactly like a "not configured" error already was) unless this is
literally `"true"` — regardless of what `SMS_PROVIDER`/`TWILIO_*` are set
to. This lets Kyle configure and test real Twilio credentials (Console
setup, webhook verification) without any risk of an actual unregistered
send. See `services/api/src/__tests__/smsProviderGating.test.ts`.

**IMPORTANT — the dashboard's SMS-notification toggle over-promised.**
"New quote SMS notifications... Get a text as soon as a customer submits"
had no indication that texts currently cannot send (dev provider, or now
the A2P gate above). **Fixed:** `isUsingDevSmsProvider()` (already
existed but was unused anywhere in `apps/app`) is now wired through
`SettingsPageClient`, which shows an honest inline notice — "SMS
notifications aren't sending yet... texts will start automatically once
it's approved" — whenever sending isn't actually active, without removing
or disabling the setting itself (a business can still save it now).

**IMPORTANT — no server-side cap on quote photos.** `createQuotePublic`/
`createQuote` are either unauthenticated or accept arbitrary caller input;
the browser's own upload UI caps photos at 6 and compresses each to
~450KB, but nothing server-side enforced that — a caller invoking the
Server Action directly could submit an unbounded number of arbitrarily
large "photo" strings straight into Postgres. **Fixed:** `validatePhotos`
in `services/quotes.ts` (mirroring the existing `validateServiceAddress`
"sanity ceiling, not a business rule" pattern) caps photo count at 12 (2x
the UI's limit) and each photo's `url` length at 8,000,000 characters
(~10x the compression target), generous enough to never constrain real
product tuning while bounding abuse. See the new tests appended to
`__tests__/quotes.test.ts`.

**TASK — customer-facing installation guide.** Added
`apps/web/src/app/install/page.tsx` (public, no login, same family as
`/privacy`/`/terms`/`/data`/`/sms-opt-in-proof`) covering WordPress,
Shopify, Wix, Squarespace, Webflow, GoDaddy, and custom-HTML installation,
written against the REAL embed mechanism (`embed.js`/
`embedSnippets.ts`'s `buildScriptSnippet`/`buildIframeSnippet`) — the
WordPress/GoDaddy/Shopify caveats mirror the dashboard's own
`WebsiteInstallClient.tsx` platform notes verbatim so the two can never
contradict each other; Wix/Squarespace/Webflow (which have no dedicated
tab in that picker) are described only at the level of their
well-documented, stable embed/custom-code features, not an invented exact
menu path. Linked from the dashboard's Website page
(`INSTALL_GUIDE_URL`, mirroring the existing `PRIVACY_URL`/`TERMS_URL`
cross-app pattern) and from the marketing site's footer. `LegalPage.tsx`
(the shared layout `/privacy`/`/terms`/`/data` already use) gained
`<ol>`/`<code>` styling it was missing — purely additive, no visual change
to any existing page, needed because this is the first page in that
family to use numbered steps and inline code.

## What was confirmed already correct (no change needed)

Multi-tenant isolation (every public estimator path resolves a business
via `resolveEmbedBusiness`/the embed id, never an arbitrary fallback;
every dashboard query is session-scoped); the Stripe integration is
already fully environment-agnostic (no code change needed to go live —
see the Stripe Live Checklist delivered alongside this audit); the
AI→pricing boundary (AI never supplies a dollar amount — tested); the
human-review gate (`determineInitialQuoteStatus` escalates genuine
uncertainty to `needs_review`; an estimate only ever reaches a customer
via an explicit "Approve estimate" dashboard click, never automatically);
email delivery (`RESEND_API_KEY`/`EMAIL_FROM_ADDRESS`/`EMAIL_PROVIDER`
already configured in Vercel production, unlike SMS); session/cookie
security (httpOnly, secure-in-production, sameSite=lax, hashed opaque
tokens); and the embed script itself (origin derived from its own `src`,
cannot be tricked into showing another business, auto-resizing iframe
isolation already correctly implemented).

## What was deliberately not built

No redesign of the estimator, pricing engine, or billing architecture. No
new SMS message types or triggers. No removal of SMS/Twilio
infrastructure — `SMS_A2P_APPROVED` is additive and reversible (a single
env var flip once the campaign is approved; see that var's own comment in
`notifications/sms/index.ts` and `.env.example` for the exact post-
approval step). No live Stripe credentials inserted or Stripe switched to
live mode — see the separately delivered Stripe Live Checklist. No
removal of `/dashboard/testing` ("AI Testing" in the main nav) — flagged
in the audit report as a minor, non-security polish item (an internal
benchmark tool visible to every business, including a new paying
customer) rather than fixed, since hiding/relabeling nav is a product
decision outside a bug-fix's scope.

## Verification

`pnpm --filter @tallyvis/api test`: 427/427 passing (10 new — 7 for the
`SMS_A2P_APPROVED` gate, 3 for the photo ceiling). Root `pnpm typecheck`
and `pnpm lint`: clean across all 8 packages. `pnpm --filter
@tallyvis/app build` and `pnpm --filter @tallyvis/web build`: both clean,
`/install` and the Twilio webhook route both present in their respective
route manifests. Nothing pushed or deployed as part of this audit.
