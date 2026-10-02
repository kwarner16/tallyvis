# 0040 — TallyVis Founding Creator Program (referral/affiliate system)

## Status

Accepted. A new production feature, not a hardening pass — built on top
of, and carefully not disturbing, the existing auth/signup, Stripe
billing/webhook, and admin-dashboard architecture (see "What this does
NOT touch" below).

## Context

Kyle wants to partner with window-cleaning/home-service creators who
promote TallyVis with a unique referral link, with reliable attribution
from click → signup → paying subscription → commission, plus full
CEO/admin visibility and manual payout tracking. No automated payouts,
no Stripe Connect, no creator-facing portal in V1 — see "Deferred" below
for the complete list of what was deliberately not built.

## Architecture

Three new tables (migration `0015_creator_program.sql`), additive only —
nothing about `businesses`, `users`, `subscriptions`, or
`billing_charges` changes shape:

- **`creators`** — one row per creator: identity, public referral
  `slug`, status, `commission_rate_bps`/`commission_duration_months`
  (this creator's CURRENT terms), notes, an optional `business_id` link
  to their own TallyVis business (for complimentary access), and a plain
  `click_count` counter.
- **`creator_referrals`** — the durable "business X was referred by
  creator Y" record. `UNIQUE(business_id)`: a business can be referred
  by at most one creator, ever, enforced by the database, not just by
  which code paths happen to exist.
- **`creator_commissions`** — one row per commission-eligible Stripe
  invoice payment. `UNIQUE(stripe_invoice_id)` is the idempotency
  mechanism for webhook replays.

A deliberately REJECTED fourth table: a per-click events log. The admin
dashboard's "referral clicks" metric is answered by a plain atomic
`creators.click_count` counter (`UPDATE ... SET click_count = click_count
+ 1`) instead — sufficient for "how many clicks has this creator's link
gotten," which is all V1 needs, at a fraction of the schema/write cost of
a growing events table. See "Deferred" for what a real click-analytics
table would add later if ever needed.

## Attribution model

1. **The link**: `tallyvis.com/r/<slug>` (apps/web) is a plain,
   logic-free redirect to `app.tallyvis.com/r/<slug>` (apps/app), which
   does all the real work — validating the slug, recording the click,
   and setting the cookie. apps/web has no database access at all (see
   docs/decisions/0002-app-separation.md) and this doesn't change that.
2. **Validation**: the slug must match a simple format
   (`[a-z0-9][a-z0-9-]{1,31}`, lowercase) AND resolve to a creator whose
   status is exactly `"active"`. A malformed slug, an unknown slug, and
   a real-but-inactive creator are all treated IDENTICALLY by the
   `/r/[slug]` route: redirect onward, set no cookie, surface no error —
   so none of the three is distinguishable to a visitor (or a bot)
   probing for valid codes.
3. **The cookie** (`tv_ref`): first-party, `HttpOnly`, `Secure` in
   production, `SameSite=Lax`, `Path=/`, **30-day** max-age, set on
   `app.tallyvis.com` only. 30 days was chosen as a realistic V1
   attribution window for a B2B purchase decision (a window-cleaning
   business owner is unlikely to click a creator's link and sign up
   months later, but a same-day decision is also not guaranteed) —
   matching the architecture's existing precedent of a fixed, documented
   policy constant rather than a tunable with no stated reasoning (see
   `packages/config/src/trial.ts`'s identical shape for the trial-length
   policy). The value is `slug:firstObservedAt` — plain text, not a
   signed/opaque token, because the slug is ALREADY public (it's the
   literal URL path segment a creator hands out); storing it in
   cleartext in a cookie exposes nothing that wasn't already public.
   `HttpOnly`+`Secure` prevent casual client-side tampering; see
   "Security" below for the residual, accepted risk of a determined
   attacker hand-crafting a cookie value.
4. **No cross-domain cookie coordination needed**: because the cookie is
   set on `app.tallyvis.com` (where signup actually happens) rather than
   `tallyvis.com` (the marketing site), there's no need for a
   `Domain=.tallyvis.com` attribute or any handshake between the two
   separate Vercel projects — the browser just keeps a host-scoped
   cookie for `app.tallyvis.com` and sends it back on any later request
   there, regardless of what other sites/pages were visited in between.
5. **First-click wins, pre-signup**: `/r/[slug]` never overwrites an
   EXISTING attribution cookie, even for a different creator's slug.
6. **Durable, post-signup attribution**: `attributeReferral`
   (`services/creatorReferrals.ts`) runs exactly once, AFTER a brand-new
   business's row has already committed inside `signUp`/
   `createAccountFromGoogle` — never from inside that transaction (a
   later step failing and rolling back must never leave an attribution
   row for a business that doesn't exist), and never on a path that
   throws. It independently RE-VALIDATES the cookie's slug (never trusts
   the cookie's mere presence — the creator could have been deactivated
   since the click) before writing anything. "Cannot be casually
   overwritten" is enforced by the `UNIQUE(business_id)` constraint
   itself, not merely by no code path attempting a second write — a
   conflicting concurrent attempt is caught and treated as a no-op.
   Attribution therefore survives the cookie being cleared/expiring
   immediately after signup, by design: once the `creator_referrals` row
   exists, nothing about the browser matters anymore.
7. **An implausible `firstObservedAt`** (future-dated, or older than the
   cookie's own 30-day+1-day slack window — only reachable via a
   tampered cookie) is clamped to "now" rather than trusted. This value
   is DISPLAY-ONLY (shown on the admin creator detail page as "first
   observed") — it never feeds any monetary calculation, which always
   derives from `commission_window_started_at`, stamped server-side at
   the first real Stripe payment (see below).

## Commission calculation

**Source of truth: Stripe's `invoice.paid` webhook event**, newly
handled in `services/billingWebhooks.ts` alongside the existing
`checkout.session.completed`/`customer.subscription.*` branches (added,
nothing existing changed). This was the one deliberate, carefully-made
decision in this whole feature: the existing webhook handler, before
this feature, intentionally did NOT subscribe to any `invoice.*` event —
subscription ENTITLEMENT (what access a business gets) is fully decided
by `customer.subscription.*` events alone, and that is UNCHANGED here.
Commission calculation is a genuinely separate concern with a different
correct source of truth: `invoice.amount_paid` is the actual amount
Stripe collected for that billing period, already net of any
coupon/discount — exactly "eligible collected subscription revenue," the
literal requirement. Reusing `customer.subscription.updated`'s status
transitions for commission math would have conflated "is this
subscription entitled to access" with "was money actually collected,"
which are related but distinct facts.

- **Failed payments never produce a commission** — not via any special
  check, but structurally: Stripe only emits `invoice.paid` for an
  invoice that was actually paid. `invoice.payment_failed` is a
  different event type this feature never subscribes to.
- **A $0 invoice** (e.g. the first invoice during a Stripe-side free
  trial) produces no commission — `amount_paid <= 0` is an explicit
  early return.
- **Discounts/coupons** are handled implicitly and correctly: `amount_paid`
  is already the post-discount amount Stripe actually collected, so no
  separate discount-aware logic was needed.
- **Plan changes** (a Stripe Customer Portal upgrade/downgrade) generate
  their own proration invoice, which arrives as its own `invoice.paid`
  event and is sized correctly automatically — this feature operates at
  the INVOICE level, not the subscription level, so it needs no special
  case for this.
- **The one-time installation fee** (`mode: "payment"` Checkout, not
  `"subscription"`) never generates an Invoice object in Stripe at all —
  structurally excluded, no special case needed.

### The 12-month eligibility window

Stamped ONCE, the first time a referral's first commission-eligible
invoice is processed (`creator_referrals.commission_window_started_at`),
and never moved again. Every invoice (including that first one) is
checked against `window_started_at + creator.commission_duration_months`
(the creator's CURRENT duration setting, read fresh each time) — this is
exactly how "the commission duration can vary by creator without
rewriting historical records" is satisfied: raising a specific creator's
duration later extends eligibility for that referral's future invoices
without touching any already-created commission row, and a creator-rate
change behaves identically for the rate. An invoice outside the window
is simply never turned into a commission row at all (not a $0 row, not a
"no commission" row — no row).

### Idempotency

`creator_commissions.stripe_invoice_id UNIQUE`. A replayed `invoice.paid`
webhook (Stripe's own documented at-least-once delivery) hits that
constraint on the second attempt and is treated as a no-op — the same
`isUniqueViolation` catch-and-ignore pattern this codebase already uses
for `users.email`/`quote_share_tokens` uniqueness elsewhere.

### Refund handling

A NEW `charge.refunded` webhook branch. When Stripe reports any refund
amount on a charge, every commission row recorded against that charge's
invoice is reversed (`status: "accrued" → "reversed"`) — **a deliberate
V1 simplification: any refund, partial or full, reverses the ENTIRE
commission**, rather than prorating it to the refunded fraction. This
was a conscious choice, not an oversight: proportional reversal is a
reasonable future refinement, but exact-penny proration logic for a
case this rare (a partial refund on a referred subscriber) wasn't worth
building before any creator has even been added to the program. An
already-`"paid"` commission (Kyle has already sent the creator real
money) is NEVER auto-reversed by a later refund — that row stays
`"paid"`, and reconciling a refund that arrives after a manual payout is
left as a direct conversation between Kyle and the creator, which the
system doesn't have enough context to resolve correctly on its own.

### Money arithmetic

Integer cents throughout (`collected_amount_cents`,
`commission_amount_cents`), matching every other money value in this
repo (`Plan.monthlyPriceCents`, `BillingCharge.amountCents`). Commission
rate is basis points (`commission_rate_bps`, 2000 = 20%), not a float
percentage — `Math.round(collected_amount_cents * commission_rate_bps /
10_000)`, multiplying before dividing so the computation never touches a
float value that could introduce rounding ambiguity.

## Free creator access (entitlement)

A plain boolean, `creators.complimentary_access`, checked as an early
return in `services/quotes.ts`'s TWO existing entitlement gate functions
(`requireProductAccess`/`requirePublicProductAccess`) — BEFORE either
function touches `subscriptions` at all. `hasProductAccess` itself (the
independently unit-tested, pure function every webhook/billing code path
also relies on) is completely unaware this feature exists — nothing
about its signature, its own tests, or its callers elsewhere changed.
This was the explicit "determine the safest architecture" requirement:
no fabricated Stripe subscription, no new `SubscriptionStatus` enum
value (which would have meant auditing every existing
status-mapping/admin-dashboard-counting call site), just one more
documented, narrow reason a business skips the gate — the exact same
shape `hasProductAccess` already uses for "no subscription row at all is
legacy access, not a lockout."

Granting this requires BOTH an explicit admin action
(`linkCreatorBusinessAdmin`, pointing a creator at one of their own real
TallyVis businesses) AND a second explicit admin action
(`setCreatorComplimentaryAccessAdmin`) — never implied by merely being a
creator. It additionally requires the creator's status to be exactly
`"active"` at the moment access is checked (re-verified on every quote
creation, not cached) — pausing or deactivating a creator immediately
suspends any linked complimentary access with no separate step to
remember.

## Admin dashboard

`/admin/creators` (list + program-wide metrics) and
`/admin/creators/[id]` (detail: info/edit form, status buttons,
referred-businesses table, unpaid-commissions table with per-row "Mark
paid," settled-commission history, free-access linking). Gated by the
exact same `requireAdminContext()`/`isAdminSession` pattern every other
`/admin/*` page and `services/admin.ts` function already uses — every
new `services/creators.ts` function independently re-verifies admin
access itself, the same defense-in-depth that module's header comment
already documents, rather than trusting the page-level gate alone.

MRR/"is this subscription actually active-and-paying" reuses
`services/admin.ts`'s existing `isSubscriptionPastDue`/
`@tallyvis/config`'s `getPlan` — the exact same accounting the
platform-wide admin overview already uses, so "referred MRR" can never
silently disagree with the platform's own MRR definition.

## Public `/creators` page and application

A polished, on-brand page (apps/web) pitching the program (no
fabricated income claims), ending in an application form. That form
reuses apps/web's EXISTING contact-form email infrastructure
(`CONTACT_RESEND_API_KEY`/`CONTACT_EMAIL_FROM_ADDRESS`/
`CONTACT_EMAIL_TO_ADDRESS` — the same three env vars, same Resend HTTP
call, just a different subject line) rather than introducing a second
form-handling path. **No `creators` database row is created from this
public form** — an application is a lead (an email Kyle reads); the real
`creators` row is only ever created deliberately, by Kyle, through the
admin UI once he's decided to bring someone on. This keeps the public
surface free of any ability to write to the `creators` table at all.

## What this does NOT touch

- `hasProductAccess`'s signature, body, or existing test suite.
- Subscription status/`providerStatus` semantics or mapping
  (`STRIPE_TO_INTERNAL_STATUS`) — unchanged.
- Any EXISTING webhook branch
  (`checkout.session.completed`/`customer.subscription.*`) — two new
  branches (`invoice.paid`/`charge.refunded`) were added alongside them.
- The public estimator's core flow, authentication, or onboarding beyond
  one new optional parameter (`pendingReferral`) threaded through
  `signUp`/`signInWithGoogle`, read and decoded entirely in apps/app
  (services/api never imports `next/headers`).
- Business/user/subscription table schemas.

## Privacy / security

- Referral codes are public by design (the whole point is sharing them)
  — nothing about a creator's internal `id` is ever exposed through the
  slug, the cookie, or the `/r/[slug]` route's responses.
- Creator emails/internal notes are only ever readable through the
  admin-gated `services/creators.ts` functions — never returned from any
  public action.
- The referral cookie is plain (unsigned) text. **Accepted residual
  risk**: a sufficiently motivated visitor could hand-craft a
  `tv_ref` cookie naming an arbitrary real, active creator's slug before
  signing up, causing an undeserved commission to accrue to that
  creator. This is a monetary-integrity nuisance Kyle should be aware of
  (visible and auditable in the admin dashboard — nothing about it is
  hidden), not a security hole that exposes data or grants access to
  anything; building real fraud-resistant attribution (IP/device
  fingerprinting, signed tokens, manual review queues) was explicitly
  out of scope for V1 (see "Deferred").
- Privacy Policy gained one factual paragraph describing the referral
  cookie (what it stores, how long, that it's not sold/used for
  advertising). Terms of Service gained one new section describing the
  program's existence, that TallyVis can modify/end it, and the
  creator's disclosure responsibility — deliberately WITHOUT restating
  the specific 20%/12-month commission terms (those belong in a separate
  creator agreement, drafted but NOT published —
  `docs/product/creator-program-terms-draft.md`, explicitly marked DRAFT
  pending Kyle's/legal review before ever being sent to a real creator).

## Deferred (explicitly out of scope for this phase)

Per the brief's own "DO NOT BUILD YET" list, confirmed still not built:
automated payouts of any kind (bank/Stripe Connect/PayPal), tax-document
automation, a creator-facing login/dashboard, social-post scheduling,
influencer discovery/scraping, email campaign automation, multi-level
referrals, contests/gamification, and fraud scoring beyond the
first-click/UNIQUE-constraint protections described above.

A future creator-facing dashboard (clicks/signups/paid
customers/commissions/payout history) needs NO database redesign to add
later: every number it would show is already a straightforward read
against `creators`/`creator_referrals`/`creator_commissions` scoped to
one creator — the only new work would be a creator-specific
authentication mechanism (deliberately not built now) and read-only
view-layer code reusing the same aggregation queries
`services/creators.ts` already has.

## What was and wasn't verified

Every new piece of business logic (referral resolution/eligibility,
attribution persistence and its immutability, commission calculation
across the full matrix the brief asked for — success, failure, refund,
replay, rate/duration variation, eligibility-window boundaries,
complimentary access, admin authorization) is covered by automated
tests against this environment's real Postgres test database — see the
test files listed in the final report. What was NOT exercised: a real
Stripe test-mode `invoice.paid`/`charge.refunded` webhook delivery (the
tests hand-build the event payloads, the same established pattern this
repo already uses for `checkout.session.completed`/
`customer.subscription.*` testing), and no real email send through
Resend for the creator application form. Both are consistent with how
every other Stripe-webhook and email-sending feature in this repo has
been verified to date — "unverified live" by the same standard, not a
gap specific to this feature.
