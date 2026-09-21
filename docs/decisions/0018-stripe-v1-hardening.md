# 0018 — Stripe V1 hardening: production-ready billing for the first real customer

**Status:** Accepted (Phase 14 hardening pass — not a new phase)

## Context

With the founder's final V1 pricing and product decisions in hand, this
pass made Tallyvis's existing billing implementation (ADR 0016, hardened
once already in ADR 0017) production-ready for a first real paying
customer in Stripe **test mode**. It followed Stripe's own official
`stripe_implementation_planner` recommendation (via the authenticated
Stripe MCP plugin) for this SaaS shape — hosted Checkout, flat-rate
plans, card-on-file trial, Customer Portal, Smart Retries, no
Connect/Invoicing/annual billing — and an audit of the existing
implementation, then closed every gap the comparison surfaced. No
architecture was rebuilt: the provider abstraction, webhook signature
verification, replay idempotency, tenant isolation, and
server-authoritative price/businessId design from ADR 0016/0017 are all
preserved and extended, not replaced.

## Final V1 product decisions (founder-approved, no longer placeholders)

- **Plans:** Starter $69/mo, Growth $159/mo, Pro $299/mo — monthly only,
  no annual billing yet.
- **Trial:** 7 days, card required upfront via Stripe Checkout, Stripe
  owns the trial clock once a real subscription exists.
- **Installation:** Self-install (free, no Stripe interaction) or
  Professional installation ($299 one-time), mutually exclusive, entirely
  separate from the recurring subscription.
- **Founding-customer waiver:** a manual, script-driven override (see
  below) — not a coupon/promotion system, and the public $299 price is
  never modified.
- **No AI usage limits yet** — all three plans keep full estimator access
  pending real production usage/cost data.

## What changed

### 1. Persistent Stripe Products/Prices replace inline `price_data`

Created once via the authenticated Stripe MCP against the TallyVis
sandbox test-mode account (`acct_1UICRcBQynNZC2wg`): three recurring
Products/Prices (Starter/Growth/Pro) and one one-time Product/Price
(Professional Installation). `@tallyvis/config`'s `PLANS` and
`PROFESSIONAL_INSTALLATION_FEE` remain the single authoritative
definition — each now additionally carries a `stripePriceEnvVar` field
naming (never holding) the env var that resolves its real Price id for
the running environment. `services/api/src/billing/index.ts` is the only
place that reads `STRIPE_PRICE_STARTER`/`_GROWTH`/`_PRO`/`_INSTALLATION`
(`resolveStripePriceId`/`resolveInstallationPriceId`), exactly mirroring
how it's the only place `STRIPE_SECRET_KEY` is read. This was required,
not optional: the Stripe Customer Portal's plan-switching feature can
only offer a fixed, pre-configured set of Price ids — it cannot work
against Checkout-time inline `price_data` at all.

Test-mode and live-mode Stripe accounts issue different ids for "the
same" price, so these ids are environment configuration (in
`apps/app/.env.local` for local dev, Vercel env vars later), never
committed — this is what prevents a test-mode deployment from ever
referencing a live price or vice versa.

### 2. The two competing trial paths are reconciled — Checkout is the only production path

ADR 0017's audit had already flagged this. `PlanSelector.tsx` now has
exactly one button ("Start 7-day free trial"), which always goes through
`createCheckoutSessionForPlan` → real Stripe Checkout, card required. The
DB-only, no-card `startTrial` still exists in
`services/subscriptions.ts` — most of this file's own test suite still
uses it as trial-state setup infrastructure — but it is no longer wired
to any production UI affordance. A real signup can no longer acquire
product access without ever going through Stripe.

### 3. The `checkout.session.completed` status-mapping bug is fixed

Previously, `handleStripeWebhook` hardcoded `status: "active"` on
`checkout.session.completed`, even when Stripe had actually created a
`trialing` subscription — that event's payload says nothing about
trial-vs-active status. The fix: `checkout.session.completed` now only
links `billingCustomerId`/`providerSubscriptionId`/`planId`, leaving
`status` exactly as it already was (typically `"incomplete"` from
`createCheckoutSessionForPlan`). A new `customer.subscription.created`
handler (previously unhandled) supplies the real status moments later,
through the same Stripe-status → internal-status mapping table
`customer.subscription.updated` already used. A dedicated regression
test simulates the realistic checkout → subscription-created sequence
and asserts the end state is `trialing`, never a premature `active`.

### 4. Out-of-order webhook event protection

ADR 0017 explicitly scoped webhook idempotency to exact replays only,
noting that a genuinely different, older event arriving late (delivery
jitter/retries) could still regress state — no id-based check catches
that, since the ids differ. Migration `0006_webhook_event_ordering.sql`
adds `subscriptions.last_webhook_event_created_at`, storing the most
recently *applied* event's Stripe-assigned `created` timestamp (Unix
seconds, present on every real Stripe event). `handleStripeWebhook`
rejects any incoming event whose `created` is older than what's stored,
in addition to the existing exact-id-match replay check. This was a
small, targeted addition — not a full ordered-event log — proportional
to what Stripe actually recommends (compare event timestamps when
delivery order isn't guaranteed) rather than building new
infrastructure. Hand-built test payloads without a `created` field skip
the ordering check (back-compat), matching how they already skip
exact-replay detection when they omit `id`.

### 5. Customer Portal (`docs.stripe.com/customer-management`)

`BillingProvider` gained `createPortalSession`. A portal *configuration*
was created via the authenticated Stripe API (`billing_portal/
configurations`, no Dashboard-only step required) with: payment method
update, invoice history, `customer_update` (email/address/name),
cancellation (`at_period_end`, no proration), and plan switching scoped
to exactly the three real Price ids, with
`trial_update_behavior: "continue_trial"` — critical, since Stripe's
default would otherwise end a business's trial the moment they switch
plans mid-trial, which the founder's requirements explicitly forbid.
`services/subscriptions.ts`'s `createBillingPortalSession` requires an
existing `billingCustomerId` (a business must have been through Checkout
at least once); the dashboard's new "Manage billing" button (only shown
once that's true) redirects there — no custom card-management UI was
built, per Stripe's own recommendation and the brief.

Portal-driven plan switches arrive as ordinary `customer.subscription.
updated` events carrying the new Price id in
`items.data[0].price.id`. `billing/index.ts`'s new
`resolvePlanIdFromPriceId` reverse-resolves that back to our own
`PlanId` so `subscriptions.plan_id` stays in sync after a
portal-initiated change, not just a Tallyvis-initiated one. An
unrecognized price (foreign/stale data) leaves the existing `planId`
untouched rather than corrupting it. Switching plans — in either
direction, any number of times — never touches `trialStartedAt`/
`trialEndsAt` and never creates a second subscription row (both are
enforced by construction: this webhook path only ever calls
`upsertSubscription`, whose UPDATE path is a true partial patch, against
the one `UNIQUE(business_id)` row).

### 6. The one-time professional installation fee is now a real, working payment

ADR 0017's audit found `markBillingChargeStatus` had zero callers — a
charge could structurally never become "paid." Fixed:
`createInstallationCheckoutSession` creates (or reuses, if one's already
`pending`) a `billing_charges` row, then a `mode: "payment"` Checkout
Session referencing the persistent installation Price, with the charge's
own id and businessId round-tripped through metadata. `handleStripeWebhook`
branches on `metadata.billingChargeId`: it looks up that exact charge,
cross-checks `businessId` as defense in depth against tampered/foreign
metadata, refuses to reprocess a charge that isn't still `pending`
(covering both "already resolved" and "replayed event" in one check),
and marks it `paid` with the Stripe `payment_intent` id. This never
touches `subscriptions` — installation and the recurring plan remain
architecturally and operationally separate, as ADR 0016 originally
specified. A failed/abandoned Checkout attempt simply never produces a
`checkout.session.completed` event, so the charge naturally stays
`pending` — there was no need to invent a `"failed"` status (ADR 0017
already reasoned about why one wasn't added).

Self-install records a `$0`, immediately-`waived` charge and never calls
Stripe at all — "do not create fake $0 Stripe payments unless there is a
concrete reason" (there wasn't one).

### 7. Founding-customer installation waiver — a script, not a promotion system

There is no admin UI anywhere in this app (a business only ever manages
its own account) and the brief explicitly ruled out building a
coupon/promotion subsystem for this. `services/api/src/db/
waiveInstallation.ts` (run via `pnpm --filter @tallyvis/api
waive-installation <owner-email>`, the same one-off-script pattern
`seed.ts` already established) marks one named business's installation
charge `waived` directly — creating it at its real $299 price first if
the business hasn't reached that choice yet, so the record accurately
reflects what was waived for the founder's own bookkeeping, and refusing
outright if the charge has already been paid. `@tallyvis/config`'s
public price is never touched by this script.

### 8. Stripe Customer reuse

`createCheckoutSessionForPlan` and `createInstallationCheckoutSession`
both pass `customer: <existing billingCustomerId>` instead of
`customer_email` whenever a business already has a Stripe Customer on
file (from any prior checkout, subscription or installation), rather
than letting Stripe mint a new Customer on every attempt. Only a
business's very first-ever checkout falls back to `customer_email`. This
is not perfect deduplication — repeated *abandoned* first-checkout
attempts before ever completing one can still each create a Customer,
since `billingCustomerId` is only populated by a completed checkout's
webhook — but this is normal, accepted Stripe integration behavior
(abandoned-checkout Customers are inert) and proactively pre-creating a
Customer before any checkout intent was judged disproportionate
complexity for V1.

### 9. `invoice.paid`/`invoice.payment_failed` deliberately left unhandled

Evaluated per the brief's request, and documented in code rather than
built: `customer.subscription.updated` already delivers the resulting
`trialing`/`active`/`past_due`/`canceled` state whenever a payment
succeeds or fails, because Stripe transitions the subscription's own
status as part of that same lifecycle event. A dedicated invoice handler
would only duplicate a state transition this app already mirrors, without
adding information anything here acts on. Smart Retries and Stripe's own
automated failed-payment emails own the recovery workflow itself, per the
brief's explicit "do not build a custom retry engine." `past_due` maps to
internal `"active"` (access preserved during Stripe's own grace
period/retries — unchanged from ADR 0016); `unpaid`/`incomplete_expired`/
`paused` map to `"expired"` (access revoked once Stripe has genuinely
given up).

### 10. UI copy corrected

`PlanSelector.tsx` and the onboarding page no longer claim "no credit
card required" — both now state plainly that a card is required to start
the trial and billing begins automatically afterward unless canceled.
The billing page gained the installation choice (Professional $299 /
Self-install Free, via two new small client components) and a "Manage
billing" button once a Stripe Customer exists. No dashboard redesign —
these are additions to the existing billing page's existing sections.

## What was NOT changed

Stripe Invoicing was evaluated and deliberately not adopted — subscription
invoices Stripe Billing already generates are sufficient, and the
one-time installation fee is a Checkout payment, not a manually-managed
invoice; Stripe Invoicing's `send_invoice`/net-terms workflow doesn't fit
a self-serve, card-based SaaS. Stripe Connect remains not applicable —
Tallyvis bills its own direct SaaS customers only. No annual pricing, no
coupon/promotion system, no custom retry/dunning engine, no custom
card-entry UI, no AI usage limits. `packages/pricing` is untouched.

## Consequences

- `subscriptions` gained one column
  (`last_webhook_event_created_at`, migration `0006`), additive,
  nullable, no backfill needed.
- `BillingProvider`'s `createCheckoutSession` signature changed
  (`priceId`/`mode`/`customerId` replace `monthlyPriceCents`/`planName`);
  every caller and test was updated accordingly — this is a breaking
  change to that internal interface, not a public API.
- `@tallyvis/config`'s exported `WEBSITE_INSTALLATION_FEE` was renamed to
  `PROFESSIONAL_INSTALLATION_FEE` to reflect the new self-install/
  professional distinction; all references were updated.
- `startTrial`'s automatic installation-charge creation was removed —
  installation is now always an explicit, separate choice
  (`chooseSelfInstall`/`createInstallationCheckoutSession`), never a side
  effect of starting a trial.
- Known limitations, stated rather than hidden: no real Stripe checkout,
  webhook, or portal session has been exercised against Stripe's live
  network in this environment — only against the authenticated Stripe
  MCP (for catalog/portal-configuration creation and read-verification)
  and hand-built payloads/a local fake HTTP server (for webhook/provider
  behavior); Customer-deduplication is best-effort, not airtight, for
  repeated abandoned first-time checkouts (see §8); this environment had
  no connected browser automation available to visually verify the
  rendered dashboard screens, so that verification still needs a human
  pass once `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` are configured
  locally.
