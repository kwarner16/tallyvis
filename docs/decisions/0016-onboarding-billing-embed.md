# 0016 — Customer onboarding, billing, notifications & website embedding

**Status:** Accepted (Phase 14)

## Context

Phases 1–13 built a real, multi-tenant, AI-assisted estimating product:
authenticated business accounts, persistence, pricing configuration, the
quote workflow, secure quote sharing, AI property analysis, and real-world
job-outcome recording. What was still missing was everything that turns
this into a product a real business can actually *sign up for, trial,
configure, connect to its own website, and use with customers* — account
recovery, a way to notify a customer at all, a subscription/trial model,
and a way to put the estimator somewhere other than Tallyvis's own domain.
This phase builds the foundation for all four, as a working vertical
slice each — not a large billing platform, not six website integrations,
not a CRM. Four small, real, connected systems.

## Decision

### 1. Password recovery

`password_reset_tokens` follows the exact pattern `sessions.token_hash`
and `quote_share_tokens.token_hash` already established: only a SHA-256
hash of the raw token is ever stored, tokens expire (1 hour), and a token
is single-use — consumed by setting `used_at`, never deleted, so a replay
of an already-used token is still detectable and rejected rather than
looking like an unknown token.

`services/passwordReset.ts`'s `requestPasswordReset` never reveals
whether an email belongs to a real account — identical outcome either
way, the same non-enumeration guarantee `logIn` already documents for
"wrong password" vs. "no such user." A best-effort, single-process
cooldown (60s per email) throttles repeated requests — explicitly the
same "not a distributed rate limiter" caveat `aiAnalysis.ts`'s dedup cache
already carries, since this architecture has no separate rate-limiting
infrastructure to hook into.

A successful `resetPassword` revokes every existing session for that user
(`revokeAllSessionsForUser`, new in `auth/session.ts`) — a password reset
is a strong enough "I might have lost control of this account" signal
that every other signed-in device should be forced to log in again, not
just the one that completed the reset.

No email credentials exist in this environment, so the dev-safe testing
mechanism (the notification abstraction's dev provider, below) is how
this flow was actually exercised end-to-end — including against the real
dev SQLite database, not just `:memory:` test fixtures.

### 2. Notification architecture

`services/api/src/notifications/` mirrors `services/ai`'s `AiProvider`
abstraction exactly: a narrow `EmailProvider` interface, a categorized
`NotificationError`, and provider resolution from one environment
variable (`EMAIL_PROVIDER`) in one file
(`notifications/index.ts`'s `resolveEmailProvider`). Two providers exist:

- **`devEmailProvider`** (default) — never sends anything real. Logs the
  full message, including any link (a password reset link, a quote link),
  to the server console — the dev-safe mechanism this phase's brief asks
  for, exercised in every password-reset and quote-email test.
- **`createResendProvider`** — a real transactional-email integration via
  Resend's HTTP API, plain `fetch`, no SDK dependency (same choice as
  `services/ai/providers/anthropic.ts` made for the Anthropic SDK, just in
  the opposite direction — here avoiding a new dependency where a small
  `fetch` call suffices). Only reached when `EMAIL_PROVIDER=resend` and
  both `RESEND_API_KEY`/`EMAIL_FROM_ADDRESS` are set. **No credentials
  exist in this environment, so this path has not been exercised against
  Resend's real API** — only its request/response shape has been written
  against Resend's published contract. This is stated explicitly, the
  same way ADR 0013/0014 stated it for the Anthropic provider.

An `SmsProvider` was not built — no existing SMS provider/integration is
available or clearly appropriate yet, and the brief is explicit that SMS
shouldn't be added before the email architecture is solid. The interface
shape (`NotificationError`, provider resolution pattern) is designed so
adding one later is additive, not a redesign.

### 3. Customer quote email

`services/quoteEmail.ts`'s `sendQuoteEmail` reuses the EXISTING secure
quote-share token mechanism (`generateShareLink`, ADR 0012) rather than
inventing a second public-authorization path — the link in the email IS a
share link. Generating a fresh one revokes any previously-generated link
for that quote, the same behavior "Regenerate" in the dashboard's share
panel already has.

The email itself is deliberately concise: business name, the customer's
name, the estimate total, and the link — never the line-item breakdown,
never internal notes, never anything about the pricing configuration that
produced it. A test (`quoteEmail.test.ts`) asserts the composed message
literally does not contain the quote's internal notes or any line-item
label. Delivery metadata is the minimum useful amount: `email_sent_at`,
`email_delivery_status` ("sent"/"failed"), `email_provider_message_id` —
one current-attempt slot on the `quotes` row, the same "most recent, not
a history" shape `changes_requested_at`/`customer_request_note` already
established. A provider failure is never swallowed into a false "sent" —
it's recorded as `"failed"` and re-thrown as a safe, categorized message.

### 4. SaaS plan and trial architecture

`subscriptions` is one row per business — its CURRENT billing state, not
an event history — with exactly the fields the brief names: `plan_id`,
`status`, `trial_started_at`/`trial_ends_at`, `current_period_start`/
`current_period_end`, `billing_customer_id`, `provider_subscription_id`,
`provider_checkout_session_id`. `plan_id` references `@tallyvis/config`'s
`PLANS` — the single authoritative plan definition, not a database table,
so a plan's price/features are defined exactly once and read identically
by apps/web's marketing pricing section and apps/app's onboarding/billing
screens.

`resolveEffectiveStatus` computes whether a trial has actually expired at
READ time (comparing `trial_ends_at` to now), rather than depending on a
background job to flip the stored `status` — so access decisions are
never stale even if nothing has "noticed" the trial ended yet.
`hasProductAccess` is the server-authoritative gate: a business with NO
subscription row at all gets legacy/pre-billing access (every business
created before this phase, or that hasn't been through onboarding yet, is
unaffected — this phase adds the CAPABILITY to gate, it does not
retroactively lock anyone out); once a subscription row exists, access
requires an effective status of `"trialing"` or `"active"`.

This gate is wired into exactly one place: `services/quotes.ts`'s
`createQuote` (the authenticated dashboard flow). It is deliberately NOT
applied to the public estimator's `createQuotePublic` — narrowing where
real enforcement lands keeps this phase's foundation low-risk; extending
it to the public flow is a natural next step, not done here. A dedicated
test (`subscriptions.test.ts`) confirms a business with no subscription
row can still create quotes exactly as before this phase, and that an
expired trial is blocked with a clear message.

The business account (`businesses`) remains completely distinct from its
subscription — `subscriptions.business_id` is a foreign key, never a
column on `businesses` itself, so "the business" and "what it's currently
paying for" can evolve independently, exactly as the brief asks.

### 5. Seven-day free trial

`startTrial(db, session, planId)` is the entire self-serve trial flow —
validates the plan id against `@tallyvis/config`'s `PLANS`, sets
`trial_started_at`/`trial_ends_at` (`TRIAL_DAYS = 7`), and needs no
payment method at all. This matches the brief's own flow exactly: sign up
→ dashboard → onboarding prompt → select plan → start 7-day trial →
product access, with no card anywhere in that path. `apps/app`'s
`/dashboard/onboarding` page is that prompt; `/dashboard`'s home page
shows a banner linking to it whenever no subscription exists yet, and a
different banner ("Your trial has ended") once one has expired —
`resolveEffectiveStatus`/`hasProductAccess`, never client-side-only UI
state, decide which.

### 6. Billing provider integration (Stripe)

`.env.example` already reserved `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`
as of an earlier phase's placeholder, confirming Stripe as the intended
provider — this phase builds that integration boundary for real, modeled
using Stripe's own concepts (a Checkout Session, in subscription mode,
with `price_data` — an inline, ad-hoc price — rather than requiring a
Product/Price to be pre-created in the Stripe dashboard, so a plan's price
is never duplicated outside `@tallyvis/config`). `services/api/src/billing/`
mirrors the same provider-abstraction pattern as AI and notifications:
`createStripeProvider` talks to Stripe's REST API via plain `fetch` (no
SDK dependency), gated entirely behind `STRIPE_SECRET_KEY`.

**No Stripe credentials exist in this environment, so no real checkout
session has been created and no real webhook has been received or
processed.** What IS verified: `verifyStripeWebhookSignature` (pure
HMAC-SHA256 over Stripe's own documented construction) against
hand-computed signatures, including tamper/wrong-secret/replay-window
rejection; and `handleStripeWebhook`'s event handling
(`checkout.session.completed` activating a subscription,
`customer.subscription.updated`/`deleted` syncing status, including
Stripe's `past_due` mapping to still-active access) against hand-built
payloads matching Stripe's documented shape. This proves the code is
correct against the documented contract, not that it has been exercised
against Stripe's real API — the same distinction ADR 0013/0014 draw for
the Anthropic provider and this ADR draws for Resend.

When unconfigured, the dashboard says so honestly (`billingConfigured()`)
rather than showing a checkout button that would fail — the 7-day trial
itself is completely unaffected, since it was designed to need no billing
provider at all.

### Installation fee — a separate one-time billing concept

`billing_charges` is a small, general one-time-charge table
(`kind`/`status`/`amount_cents`/`currency`/`provider_charge_id`),
deliberately NOT folded into `subscriptions`. `startTrial` records one
`"website_installation"` charge (status `"pending"`) the first time a
business starts a trial, using `@tallyvis/config`'s
`WEBSITE_INSTALLATION_FEE` — **a placeholder default amount, not a
validated pricing decision**; CLAUDE.md's "Product ownership" section
reserves real pricing calls for the founder, and this is treated the same
way a labeled mock would be. No Stripe one-time-charge/PaymentIntent flow
was built for actually collecting it — the record-keeping and lifecycle
(pending/paid/waived) exist and are displayed on `/dashboard/billing`,
but marking one paid today would be a manual, out-of-band action (there
is no Tallyvis-staff admin panel in this codebase to do it from) rather
than a business self-serve capability, which wouldn't make sense for a
fee a business doesn't set for itself.

### 7. Marketing-site "Get Started" → real onboarding path

`apps/web`'s `Pricing` component previously hard-coded four tiers whose
"Get started" buttons all pointed at `/contact` — a dead end for anyone
actually trying to sign up. It now renders `@tallyvis/config`'s `PLANS`
directly (Enterprise stays a plain "Talk to us" → `/contact` card, since
it isn't a self-serve plan and was never in `PLANS`), and each "Get
started" link goes to `${SIGNUP_URL}?plan=<id>`. `apps/app`'s signup page
reads that query param, carries it through `signUpAction` as a
short-lived, httpOnly cookie (`tallyvis_intended_plan`), and
`/dashboard/onboarding` reads-and-clears it once to preselect that plan in
`PlanSelector` — "selected plan preserved" from pricing → signup →
onboarding, without creating a subscription row before the business
actually confirms it (signup itself still asks only for business
name/email/password, unchanged).

### 8–9. Website embedding architecture & isolation

`businesses.public_embed_id` (random 24-hex-char, generated at business
creation — existing rows backfilled by the migration itself via SQLite's
`hex(randomblob(12))`) is the ONE business identifier a browser is
trusted to assert directly for the public estimator. It is deliberately
not `id`: `id` is the internal handle used in authenticated URLs and
foreign keys; this is the identifier meant to sit in a public `<script>`
tag on a third-party website. `resolveEmbedBusiness(db, embedId)` is the
only way a client-supplied string turns into a `Business` — every public
Server Action that needs "which business" now accepts an optional
`embedId` and resolves through this, falling back to the existing
`getDefaultPublicBusiness` (still the Phase 9 stated simplification,
unchanged) only when no `embedId` is given at all — the marketing site's
own bare `/estimate/*` wizard. An invalid/unknown embed id resolves to
`undefined`, never a fallback to some other business — proven directly in
`embed.test.ts`.

`public/embed.js` is deliberately plain, dependency-free JavaScript (not
built/bundled — it has to run correctly on an arbitrary third-party site
with zero assumptions about that site's tooling). It reads its own
`data-tallyvis-id` attribute, computes the app's origin from its own
`<script src>`, and mounts an `<iframe src="{origin}/embed/{embedId}">`
into the target `<div>`. Isolation here is mostly "for free": an iframe
is cross-origin-isolated by the browser in both directions already — the
host page's CSS can never leak into the iframe, and (since the iframe is
same-origin only with `app.tallyvis.com`, never the host site)
host-page JavaScript cannot reach into the iframe's DOM or application
state. The one deliberate cross-frame channel is a single `postMessage`
for auto-resizing the iframe's height (`StepShell.tsx`'s
`useReportHeightToParent`, scoped to a `{source: "tallyvis-embed"}` tag so
it can't be confused with anything else), read by `embed.js` and checked
against the iframe's own origin before acting on it.

`/embed/[embedId]` is a minimal landing page: it verifies the id resolves
to a real business (`verifyEmbedIdAction`) BEFORE doing anything else, so
a typo'd/stale embed snippet fails fast with a clear message instead of
silently breaking several wizard steps later; then it persists the id to
localStorage (`persistEmbedId`, in `EstimatorContext.tsx`) and redirects
into the SAME `/estimate/property` wizard the marketing site's own bare
estimator already uses — nothing about the wizard is duplicated or forked
for embed use. localStorage (not React context) is what actually carries
the embed identity across that redirect, since it's a full remount into a
different layout subtree; React context alone would lose it. AI provider
credentials are never reachable from any embed path — the embed only ever
calls the same public Server Actions the bare `/estimate/*` wizard
already used, which were already server-only and credential-free from the
browser's perspective since Phase 11.

### 10. Business website integration setup

`/dashboard/website` ("Website → Install Tallyvis") shows: the copy/paste
snippet with the business's own real embed id already filled in; a live
preview (the same `/embed/{embedId}` route, iframed directly in the
dashboard); test instructions; and an installation-status indicator driven
by `businesses.embed_last_seen_at`, bumped by `resolveEmbedBusiness`
itself every time the embed actually resolves — a real, safely-determinable
signal ("has this snippet ever actually loaded"), not detection of *which*
website platform it's on. No per-platform (WordPress/Squarespace/Wix/...)
integrations were built — one universal embed is the whole scope here.

### 11. Business branding

`businesses` gained `logo_url`/`brand_color` (both optional, edited on
`/dashboard/settings`). Applied in exactly two customer-facing places
where it was cheapest and most valuable to wire up: the customer-facing
quote page (`CustomerQuoteView`, via `PublicBusinessSummary` — extended
with these two fields, a test updated to confirm the ONLY fields it now
exposes are `name`/`phone`/`logoUrl`/`brandColor`, still never email/id/
createdAt) and the public estimator's `/estimate/result` page. Both do
the same two things: show the logo if set, and override one CSS custom
property (`--color-accent-strong`) if a brand color is set — not a theme
system, one token. Deliberately NOT threaded through every intermediate
wizard step (`/estimate/property`, `/photos`, `/details`, `/review`) —
that would need business data fetched much earlier in the flow for a
comparatively small payoff; a stated scope boundary, not an oversight.

### 12. Onboarding checklist

`OnboardingChecklist` on `/dashboard`'s home page — five items, every
`done` state computed server-side from real signals, never a client-side
flag a business could get out of sync with reality: a subscription row
exists; the active pricing configuration's version is `> 1` (i.e., it was
actually edited, not left at the day-one default); `logoUrl`/`brandColor`
is set; `embed_last_seen_at` is set; at least one quote exists. It's
purely a guide — dismissible for the current browser session
(`sessionStorage`), auto-hides once every item is done, and never gates
any dashboard page.

## What was NOT built

No SMS provider (email architecture first, per the brief). No real Stripe
checkout/webhook exercised live — architecture only, explicitly labeled.
No per-website-platform integrations — one universal iframe embed. No
full theme editor — one logo, one color token. No CRM, no accounting
system, no advanced/subscription analytics. No fake payment flow — the
trial needs no payment at all, and checkout is either real (when
configured) or absent (when not), never simulated as if it succeeded.
`packages/pricing` has zero diff this phase — confirmed via
`git diff --stat` — subscription/billing state gates access to creating a
quote, it never participates in calculating one.

## Consequences

- `packages/types`' `Business` gained `publicEmbedId` (required — every
  row, including pre-Phase-14 ones via the migration's backfill, has one)
  and three optional fields (`logoUrl`, `brandColor`, `embedLastSeenAt`).
  `Quote` gained three optional email-delivery fields. Both are additive;
  no existing field changed shape.
- `@tallyvis/config` gained `plans.ts` (`PLANS`, `TRIAL_DAYS`,
  `WEBSITE_INSTALLATION_FEE`) — the one place either app may read plan/fee
  data from; neither app nor `services/api` may hard-code a price or
  feature list a second time.
- `CreateQuoteInput`, `getPublicBusinessAction`,
  `getPublicActiveConfigurationAction`, `analyzePublicPropertyAction`,
  `createPublicQuoteAction` all gained an optional trailing parameter
  (`embedId`) — fully backward compatible; every existing non-embed call
  site is unaffected by omitting it.
- Known gaps, stated rather than hidden: no live Resend/Stripe
  verification (no credentials in this environment); the subscription
  access gate only covers the authenticated dashboard's `createQuote`, not
  the public estimator; the installation fee has no self-serve way to be
  marked paid; branding doesn't reach the intermediate wizard steps;
  `WEBSITE_INSTALLATION_FEE`'s dollar amount is a placeholder pending the
  founder's actual pricing decision.
