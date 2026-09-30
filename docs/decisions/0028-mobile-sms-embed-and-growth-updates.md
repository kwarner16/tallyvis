# 0028 — Mobile-first dashboard, new-quote SMS alerts, universal embed installation, and growth/commercial updates

**Status:** Accepted

## Context

Customer discovery with Adam, a real window-cleaning operator who reviewed
the Tallyvis concept, surfaced three product gaps: no immediate
notification when a lead comes in, fragile installation across common
website builders (WordPress, GoDaddy, Shopify), and a dashboard not built
for how an owner actually uses it — from a phone, in a truck, between
jobs. Separately, the founder wanted three commercial changes to support
the sales push: a longer promotional trial through the end of 2026, no
installation fee for now (he's personally helping early customers
install), and a real SEO foundation, since the marketing site had none —
no `robots.txt`, no sitemap, no canonical URLs, no Open Graph/Twitter
metadata, no structured data.

This was a large, multi-part request. It was audited first (five parallel
codebase passes covering notification/billing architecture, embed
architecture, dashboard mobile state, estimator mobile state, and SEO
state) before any code changed, then implemented against a written,
user-approved plan. The full audit and plan are not reproduced here; this
records what was actually built and why, for future sessions.

## What was built

### 1. Trial policy (`packages/config/src/trial.ts`)

One authoritative `TRIAL_POLICY` object (`promoTrialDays: 30`,
`promoEndsAtUtc: "2027-01-01T00:00:00.000Z"`, `defaultTrialDays: 7`) and a
`getTrialDaysForNewSubscription(now?)` function — the only place "30" or
the promotion's end date is written. Every trial-length decision point
(`createCheckoutSessionForPlan`'s real Stripe hook, the dev-only
`startTrial`) and every piece of copy that states a trial length now reads
this function instead of a hardcoded "7" — including two pre-existing
literals that had already drifted out of sync with the old `TRIAL_DAYS`
constant (`apps/web/src/components/Pricing.tsx` and
`apps/app/src/app/dashboard/onboarding/page.tsx`).

Because Stripe locks in `trial_end` at Checkout session creation, this
only ever affects *new* sessions — no migration, no mutation of existing
subscriptions. A subscription's own actually-granted trial length is
shown in billing/settings copy via a new `apps/app/src/lib/trialDisplay.ts`
helper (`grantedTrialDays`), computed from that subscription's own stored
`trialStartedAt`/`trialEndsAt`, not from the current policy — so a
business that started during the promo keeps seeing "30" even after the
promotion has since ended for everyone else, and vice versa.

### 2. Installation fee removed from the customer-facing flow

`PROFESSIONAL_INSTALLATION_FEE` and all its Stripe/`billing_charges`
plumbing (`createInstallationCheckoutSession`, the webhook reconciliation)
are untouched and still exist, deliberately dormant — nothing in the UI
calls them anymore. `InstallationChoice.tsx` now presents a single "Get
started — no charge" action (still recording a `$0` waived charge via the
existing `chooseSelfInstall()`), and `apps/web/src/components/Pricing.tsx`
no longer mentions an installation fee. `STRIPE_PRICE_INSTALLATION` is
documented in `.env.example` as currently unnecessary in production.
Historical `billing_charges` rows and the webhook path are unaffected.

### 3. New-quote SMS alerts (Twilio)

No SMS infrastructure existed before this phase (confirmed by audit: no
`SmsProvider`, no phone-sending code anywhere). Built:

- `services/api/src/notifications/sms/` — `SmsProvider`/`SmsMessage`
  (`types.ts`), a dev console-log provider (`providers/dev.ts`), a real
  Twilio provider via plain `fetch` (`providers/twilio.ts`, no `twilio`
  npm package — same no-SDK choice `providers/resend.ts` already made),
  and `resolveSmsProvider`/`sendSms` (`index.ts`), mirroring
  `notifications/index.ts`'s email pattern exactly. `notifications/logging.ts`
  was widened (`channel: "email" | "sms"`, a new `maskPhone` alongside
  `maskRecipient`) rather than duplicated.
- Migration `0008_sms_notifications.sql` adds `businesses.sms_notifications_enabled`
  (default `false`) and `businesses.notification_phone` (nullable) —
  disabled and empty by default, so this addition can never itself cause
  an unsolicited text.
- `services/business.ts`'s `normalizePhoneNumber` (bare 10-digit → assumed
  US/+1, or accepts already-E.164) and `updateSmsNotificationSettings`
  (rejects an unparseable number, and rejects enabling with no valid
  number on file) back a new "SMS notifications" section on the dashboard
  Settings page.
- `services/quoteSmsAlert.ts`'s `sendNewQuoteSmsAlert(business, quote,
  buildQuoteUrl)` — concise message (customer name, address, window
  count/stories, estimate, customer's own phone as a convenience
  callback number, and a plain authenticated dashboard link), a
  best-effort 30s per-business cooldown (same single-process pattern
  already used by `passwordReset.ts`/`contactActions.ts`/`aiAnalysis.ts`'s
  dedup cache). Wired into `createQuotePublic` only (two new optional
  trailing parameters — `buildQuoteUrl`, `onSmsNotified` — so every
  existing call site, including ~30 across the test suite, is unaffected)
  — never into `updateQuotePublic` (re-analysis) or the authenticated
  `createQuote`, so a business's own quote creation or a customer's
  re-analysis can never trigger or duplicate an alert. `apps/app`'s
  `createPublicQuoteAction` registers the returned `finished` promise with
  Next's `after()`, the same fire-and-forget-survives-the-response pattern
  `requestPasswordReset` already established (and the same production bug
  class it was built to avoid: an unregistered background promise can be
  silently dropped when a serverless function freezes right after its
  response is sent).
- The SMS link (`/dashboard/quotes/[id]`) is a plain authenticated route,
  never a bearer token. `apps/app/middleware.ts` now appends
  `?redirect=<path>` when bouncing an unauthenticated visitor to `/login`;
  `logInAction` reads and allowlists it (must start with `/dashboard`, no
  `//`) before honoring it instead of always landing on the generic
  dashboard home — closing a real gap where an SMS deep link opened while
  logged out previously lost its destination entirely.

**Vendor:** Twilio, confirmed with the founder before implementation (the
task explicitly required reporting the provider-architecture gap and
getting a vendor decision first). Not exercised against a real Twilio
account in this environment — no credentials were available — only the
dev provider and the full gating/wiring/cooldown logic were verified, via
`services/api/src/__tests__/quoteSmsAlert.test.ts`.

### 4. Universal embed installation

Audit confirmed the iframe path was already safe to expose directly: no
`X-Frame-Options`/CSP `frame-ancestors` exists anywhere in the codebase,
and `embed.js` itself already works by generating exactly this iframe
under the hood — tenant isolation comes from the embed id itself
(`embed.test.ts`), not from restricting which parent origins may frame
it. `apps/app/src/lib/embedSnippets.ts` now exports both
`buildScriptSnippet` and `buildIframeSnippet` as pure functions (covered
by `__tests__/embedSnippets.test.ts` — the first apps/web/apps/app test
infrastructure addition beyond what already existed, a minimal
`vitest.config.ts` in each app). `WebsiteInstallClient.tsx` is rebuilt
around a platform picker (WordPress, GoDaddy, Shopify, Custom HTML,
Iframe), each with a tailored snippet and short numbered steps; the
existing live preview iframe and `embed_last_seen_at`-driven "Connected"
status indicator are unchanged.

**Compatibility, code-verified vs. human-test-required:** embed id →
business resolution, cross-tenant isolation, invalid-id safe failure with
no fallback, tenant-scoped branding, and correct snippet content are all
covered by the existing `embed.test.ts` suite plus the new snippet-builder
tests. Whether WordPress.com's free tier, a specific GoDaddy Website
Builder plan, or a specific Shopify theme's Custom Liquid section actually
accept a `<script>` tag (vs. silently stripping it) was **not** verified
against a real account on any of those platforms — this remains a human
acceptance step (see the final report given alongside this phase).

### 5. Mobile-first dashboard (targeted, not a redesign)

`DashboardShell.tsx`'s sidebar/hamburger pattern and `QuoteList.tsx`'s
table→card breakpoint were already solid and untouched. Changes, all
scoped to what the audit found missing:

- `QuoteDetailClient.tsx` (the SMS deep-link destination): a mobile-only
  (`lg:hidden`) "at a glance" summary block above the existing 3-column
  grid (status, confidence, address, `tel:`/`mailto:` links, estimate,
  submitted time); real `tel:`/`mailto:` links in the existing Customer
  card (previously plain text); a mobile-only sticky bottom action bar
  (`fixed ... lg:hidden`) surfacing the single primary status-transition
  action plus a one-tap "Call" link, so the SMS→tap→login→review→act path
  never requires scrolling past the AI-analysis/photos content first.
- `PricingRulesForm.tsx`'s difficulty-multiplier row: `grid-cols-3` →
  `grid-cols-1 sm:grid-cols-3`.
- `BenchmarkTestingClient.tsx`'s two smaller summary tables wrapped in
  `overflow-x-auto`; its one genuinely wide table (`min-w-[900px]`) is
  left as-is per its own existing code comment ("a tool for Tallyvis's own
  testing, not a customer-facing flow that needs polish").
- No new Customers page was built — none exists today (customer data is
  only ever viewed inline per-quote), and building one was out of this
  phase's scope.
- No shared `Card`/`Table` component was introduced into `packages/ui` —
  none exists today, and retrofitting one across every dashboard page
  would have been a speculative redesign well beyond what this phase's
  gaps actually required.

### 6. Mobile customer estimator (minor polish)

Audit found `/estimate/*` already mobile-first (fluid widths throughout,
zero horizontal-scroll risk, `capture="environment"` already set,
correct `type="tel"`/`type="email"`). Fixed: missing
`autoComplete="name"|"email"|"tel"` on the three contact fields in
`review/page.tsx` (address already had `autoComplete="street-address"`);
bumped the photo-remove button and the `confirm` step's Stepper buttons
toward the ~44px tap-target guideline.

### 7. SEO foundation (`apps/web`)

- `apps/web/src/lib/seo.ts`'s `SITE_URL` (env-overridable, defaults to the
  real production domain — deliberately not a localhost default, unlike
  `urls.ts`'s cross-app links).
- Root layout: `metadataBase`, a `viewport` export, `openGraph`/`twitter`
  defaults. No `verification` field was added — an empty placeholder would
  render a useless empty meta tag; the final report gives Kyle the exact
  steps to add his real Search Console verification code once he has one.
- `app/robots.ts` and `app/sitemap.ts` (Next file conventions) —
  every real content route, excluding `/estimator` (a pure external
  redirect, not indexable content).
- `app/opengraph-image.tsx` via `next/og`'s `ImageResponse` — a
  simple branded card built from text and the site's own brand-color
  tokens, since `apps/web/public/` has no raster image assets at all (the
  homepage's own Hero visual is inline SVG/CSS, not a screenshot either).
- `apps/web/src/lib/structuredData.tsx` — `Organization`/`WebSite`
  (root layout), `SoftwareApplication` (homepage), `BreadcrumbList`/
  `Article` (guide pages). No `aggregateRating`/`review`/`offers` field
  anywhere — none of that data is real.
- Homepage and every existing page gained explicit `metadata`/
  `alternates.canonical` (previously only the legal pages had their own).

**Upgrading `next` while touching `next/og`:** `pnpm audit` surfaced a
critical RCE in `next/og`'s `ImageResponse` affecting the exact Next.js
version this repo had pinned (16.3.5, vulnerable range `>=16.2.0 <16.3.6`)
— directly relevant since this phase started using that API for the first
time. `next`/`eslint-config-next` were bumped to `16.3.8` (the latest
16.3.x patch) in both `apps/app` and `apps/web`; build, typecheck, and the
full test suite were all re-run clean afterward.

### 8. Two SEO landing pages + educational content

Real web research (not assumption) confirmed search demand centers on
"AI window cleaning estimator," "photo-to-quote," and "window cleaning
quote/estimating software" as a software-category evaluation query —
matching the task's suggested phrasing. Named competitors turned up by
that research are referenced nowhere in any new copy.

Two landing pages (not three — avoiding near-duplicate pages answering the
same intent): `/ai-window-cleaning-estimator` (product-led: how the
photo→AI→human-confirm→business-priced flow actually works) and
`/window-cleaning-quote-software` (comparison-shopping intent: what to
look for in quoting software, and an honest "estimating and quoting, not a
full CRM" positioning). A new `/guides` section (`ArticleLayout.tsx`,
mirroring `LegalPage.tsx`'s semantic-HTML-plus-descendant-selectors
pattern — no MDX/CMS pipeline for two hand-written articles) with two
cornerstone articles: "How to Quote Window Cleaning Jobs From Photos" and
"What AI Can and Cannot Reliably Detect From Property Photos." No
fabricated testimonials, statistics, customer counts, or accuracy
percentages anywhere — an early draft of the second article included
illustrative accuracy percentages in a hypothetical comparison and was
rewritten without any numbers to remove even the risk of misreading them
as a real claim about Tallyvis.

Remaining content roadmap (not built, reported as future work): "How to
estimate window cleaning jobs without a site visit," "Reducing unnecessary
estimate drive time," "Adding an online estimator to your website" (this
last one already substantially overlaps the new `/window-cleaning-quote-software`
page and the dashboard's own install instructions).

## What was deliberately not done

No Stripe live-mode switch. No new npm dependencies (Twilio and every SEO
addition use plain `fetch`/Next built-ins). No new Customers page. No
global `Card`/`Table` rework. No distributed rate-limiting infrastructure.
No MDX/CMS pipeline. No mass-produced SEO pages. A pre-existing,
dev-tooling-only `vitest`/`vite` vulnerability chain (critical/high/moderate,
all inside the Vitest UI-server/`server.fs.deny` surface this repo never
enables — `"test": "vitest run"`, never `vitest --ui`) was left unpatched
rather than forcing a speculative major-version bump across the whole
monorepo's test infrastructure mid-feature-phase; flagged for a separate,
deliberate upgrade pass instead.

## Verification

`pnpm test` (`packages/config`'s trial-boundary tests, `services/api`'s
SMS/embed/business/subscription suites — 366 tests — plus new
apps/app/apps/web suites), `pnpm lint`, `pnpm typecheck`, `pnpm build`
(confirms every new route, including `sitemap.xml`/`robots.txt`/
`opengraph-image`, actually renders) all pass. `pnpm audit`'s one
directly-relevant finding (the `next/og` RCE) was fixed; see above.
Manual dev-server checks: every new `apps/web` route returns 200, the
sitemap/robots content is correct, the OG image renders as a real
1200×630 PNG, and the three JSON-LD blocks render with the expected
fields on the homepage. Live, authenticated browser verification of the
mobile dashboard changes (quote detail, settings, website-install pages)
was **not** possible in this environment (no connected browser) — this is
called out explicitly as a human acceptance step in the final report
rather than claimed as verified.
