import { getPlan, isPlanId, TRIAL_DAYS, PROFESSIONAL_INSTALLATION_FEE } from "@tallyvis/config";
import type { AuthSession } from "../auth/session";
import type { Queryable } from "../db/pg/client";
import * as subscriptionsRepo from "../repositories/subscriptions";
import type { Subscription, SubscriptionStatus } from "../repositories/subscriptions";
import * as billingChargesRepo from "../repositories/billingCharges";
import type { BillingCharge } from "../repositories/billingCharges";
import { getBusinessById } from "../repositories/businesses";
import {
  createCheckoutSession as providerCreateCheckoutSession,
  createPortalSession as providerCreatePortalSession,
  isBillingConfigured,
  resolveStripePriceId,
  resolveInstallationPriceId,
} from "../billing";

export type { Subscription, SubscriptionStatus } from "../repositories/subscriptions";
export type { BillingCharge } from "../repositories/billingCharges";

/**
 * Best-effort, single-process in-flight guard against duplicate Stripe
 * Checkout Sessions — the same documented-limitation pattern
 * `passwordReset.ts`'s request cooldown already uses (not a distributed
 * lock; sufficient for this single-instance deployment, not sufficient
 * once this app runs as multiple concurrent serverless instances — see
 * `checkoutIdempotencyKey` below for the distributed-safe complement).
 *
 * Without this, `createCheckoutSessionForPlan`/`createInstallationCheckoutSession`
 * each read existing state, then `await` a real Stripe API call, then
 * write back — a second call for the same business landing in that
 * `await` window sees the same stale "no checkout in progress" state and
 * creates a SECOND real Stripe Checkout Session before either write
 * lands. For the installation charge specifically, `billing_charges` has
 * no unique constraint on `(business_id, kind)` (unlike `subscriptions`,
 * which has `UNIQUE(business_id)`), so this could create two separate
 * pending $299 charges — and if a business completed both real Stripe
 * sessions, an actual double charge. Discovered during the Stripe V1
 * hardening audit (see docs/decisions/0018-stripe-v1-hardening.md), not
 * as a reported production incident.
 *
 * This guard alone rejects a concurrent SECOND request outright (fast,
 * friendly "already in progress" error, zero Stripe calls). It's kept as
 * defense-in-depth even now that a Stripe idempotency key exists: it's
 * instant and free, while the key only helps once a request has already
 * reached this process and called Stripe.
 */
const inFlightCheckouts = new Set<string>();

function beginCheckout(businessId: string): void {
  if (inFlightCheckouts.has(businessId)) {
    throw new Error("A checkout is already in progress for this business. Please wait a moment and try again.");
  }
  inFlightCheckouts.add(businessId);
}

function endCheckout(businessId: string): void {
  inFlightCheckouts.delete(businessId);
}

/**
 * Derives a Stripe idempotency key scoped to one LOGICAL checkout attempt
 * — the distributed-safe complement to the in-process guard above, and
 * the one that actually matters once this app runs as more than one
 * server instance (the in-process `Set` above is invisible across
 * processes; two different instances handling a near-simultaneous
 * request for the same business would otherwise each think they're the
 * only one in flight).
 *
 * Key lifecycle: `scopeVersion` is some value that's stable for as long
 * as "this same attempt" is still outstanding, and changes once it
 * genuinely resolves — callers pass the relevant row's own `updatedAt`
 * (a subscription's or a billing charge's). Two requests landing before
 * either one has written back (a double-click, two tabs, a retried
 * request) read the SAME `updatedAt` and therefore produce the SAME key,
 * so Stripe returns its original result for the second one instead of
 * creating a duplicate object. A genuinely LATER attempt — after a
 * webhook has updated the row, changing `updatedAt` — naturally derives a
 * different key, so it's never permanently blocked. Even if `updatedAt`
 * somehow never changed, Stripe itself expires an idempotency key's
 * dedup record after 24 hours, which is also comfortably longer than a
 * Checkout Session's own default expiry — so a stale key can never
 * outlive the very session it would have deduplicated against.
 */
function checkoutIdempotencyKey(kind: "subscription" | "installation", businessId: string, scopeVersion: string): string {
  return `tallyvis:${kind}-checkout:${businessId}:${scopeVersion}`;
}

/**
 * Phase 14 SaaS plan/trial/subscription foundation (see
 * docs/decisions/0016-onboarding-billing-embed.md), hardened for V1 in
 * docs/decisions/0018-stripe-v1-hardening.md.
 *
 * `subscriptions` deliberately has NO row for a business until it
 * actually starts a trial or subscribes — every business created before
 * this phase (and every one that hasn't been through onboarding yet) has
 * no subscription row at all. `hasProductAccess` below treats that as
 * "legacy/pre-billing access," not "locked out": Phase 14 introduces the
 * capability to gate on subscription state, it does not retroactively cut
 * off every business that predates it. Access decisions are computed here,
 * server-side, from stored state — never inferred from what a UI happens
 * to be showing.
 */

export async function getSubscription(db: Queryable, session: AuthSession): Promise<Subscription | undefined> {
  return subscriptionsRepo.getSubscriptionByBusinessId(db, session.businessId);
}

/**
 * The subscription's status as of right now, resolving a trial that has
 * passed its `trialEndsAt` to "expired" even if no background job has
 * flipped the stored `status` yet — computed at read time so access
 * decisions are never stale. The stored `status` itself is only ever
 * changed by an explicit action (`startTrial`, a webhook event).
 */
export function resolveEffectiveStatus(subscription: Subscription, now: number = Date.now()): SubscriptionStatus {
  if (subscription.status === "trialing" && subscription.trialEndsAt) {
    if (new Date(subscription.trialEndsAt).getTime() < now) return "expired";
  }
  return subscription.status;
}

/**
 * The server-authoritative access gate. `undefined` (no subscription row
 * at all) is legacy access, not a lockout — see this file's own comment.
 * Once a subscription row exists, access requires an effective status of
 * "trialing" or "active." "active" also covers Stripe's own `past_due`
 * grace period (see `billingWebhooks.ts`'s status-mapping table) —
 * Stripe's Smart Retries are already attempting recovery, and revoking
 * access the moment a single payment attempt fails, ahead of a transient
 * webhook delay or before retries are exhausted, would lock out a
 * business over what's often a temporary card issue. Only a subscription
 * Stripe has fully given up on (`canceled`/`unpaid`/`incomplete_expired`)
 * or a locally-expired trial denies access.
 */
export function hasProductAccess(subscription: Subscription | undefined, now: number = Date.now()): boolean {
  if (!subscription) return true;
  const status = resolveEffectiveStatus(subscription, now);
  return status === "trialing" || status === "active";
}

/**
 * DB-only, no-card trial start — NOT reachable from the production
 * onboarding UI as of the Phase 14 Stripe V1 hardening pass (see
 * docs/decisions/0018-stripe-v1-hardening.md). Retained because it's
 * useful test/internal infrastructure (most of this file's own test suite
 * uses it to set up a trialing subscription without mocking Stripe), but
 * `PlanSelector` now only ever calls `createCheckoutSessionForPlan` below
 * — Stripe Checkout, card required, Stripe-owned trial clock, is the one
 * unambiguous production signup path. Do not wire this back into any
 * customer-facing "start trial" affordance; a real signup must never be
 * able to acquire product access without ever going through Stripe.
 *
 * Idempotent with respect to the trial clock (hardening from a
 * post-launch audit): re-selecting a plan while already `trialing` or
 * `active` — including switching to a DIFFERENT plan mid-trial — only
 * changes `planId`, it never resets `trialStartedAt`/`trialEndsAt`. A
 * fresh 7-day window is only granted when there's no subscription row
 * yet, or the existing one is `canceled`/`expired`/`incomplete` (a
 * genuine (re)start). Without this, a business could indefinitely extend
 * a "free" trial by repeatedly clicking "Choose plan."
 */
export async function startTrial(db: Queryable, session: AuthSession, planId: string): Promise<Subscription> {
  if (!isPlanId(planId)) {
    throw new Error(`Unknown plan "${planId}".`);
  }

  const existing = await subscriptionsRepo.getSubscriptionByBusinessId(db, session.businessId);
  const alreadyEntitled = existing && (existing.status === "trialing" || existing.status === "active");

  const now = new Date();
  const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

  // Every field left out below is preserved as-is by `upsertSubscription`'s
  // COALESCE-based partial-patch update (see that function's own comment)
  // — no need to thread `existing?.X` through fields this function has no
  // opinion about, like a previously-linked Stripe customer/subscription id.
  return subscriptionsRepo.upsertSubscription(db, session.businessId, {
    planId,
    status: alreadyEntitled ? existing.status : "trialing",
    trialStartedAt: alreadyEntitled ? existing.trialStartedAt : now.toISOString(),
    trialEndsAt: alreadyEntitled ? existing.trialEndsAt : trialEndsAt.toISOString(),
  });
}

export async function listBillingCharges(db: Queryable, session: AuthSession): Promise<BillingCharge[]> {
  return billingChargesRepo.listBillingCharges(db, session.businessId);
}

export function billingConfigured(): boolean {
  return isBillingConfigured();
}

/**
 * Creates a real Stripe Checkout session for this business's chosen plan —
 * the ONE production onboarding path (see this file's `startTrial`
 * comment). Only reachable when Stripe is actually configured
 * (`STRIPE_SECRET_KEY` AND that plan's `STRIPE_PRICE_*` env var both set);
 * throws a `BillingProviderError` categorized `"not-configured"`
 * otherwise, which the UI renders as an honest message rather than a
 * button that fails silently.
 *
 * Reuses this business's existing Stripe Customer (`billingCustomerId`)
 * when one is already on file — from a previous checkout, however it
 * completed — rather than letting Stripe mint a new Customer on every
 * attempt; only a business's very first checkout falls back to
 * `customer_email`. The session id is stored on the subscription row
 * immediately (so a webhook can later resolve which business a completed
 * checkout belongs to via `metadata.businessId` as well); the
 * subscription's `status` itself is left exactly as it was
 * (`upsertSubscription`'s partial-patch semantics don't apply to `status`,
 * which is always required, so it's passed through explicitly as
 * `existing?.status ?? "incomplete"`) — this function alone never marks a
 * business as trialing/active. Only a verified webhook does that (see
 * `billingWebhooks.ts`, and docs/decisions/0018 for the bug this fixes:
 * `checkout.session.completed` used to hardcode "active" even when Stripe
 * actually started a trial).
 */
export async function createCheckoutSessionForPlan(
  db: Queryable,
  session: AuthSession,
  planId: string,
  urls: { successUrl: string; cancelUrl: string },
): Promise<{ url: string }> {
  const plan = getPlan(planId);
  if (!plan) throw new Error(`Unknown plan "${planId}".`);

  // Registered synchronously, before the first `await` below — see this
  // file's own comment on `inFlightCheckouts` for why: `getBusinessById`
  // is a real network round trip against Postgres (unlike the SQLite-era
  // synchronous lookup this guard was originally written against), so a
  // guard registered AFTER it would leave a real race window where two
  // near-simultaneous calls could both pass the (not-yet-registered) guard
  // before either finishes its own lookup — defeating the guard's entire
  // purpose. Registering it here, before anything async happens, restores
  // the "whichever call was actually invoked first wins" guarantee
  // regardless of how the two calls' subsequent database round trips
  // happen to interleave.
  beginCheckout(session.businessId);
  try {
    const business = await getBusinessById(db, session.businessId);
    if (!business) throw new Error("Business not found.");

    const priceId = resolveStripePriceId(plan.id);
    const existing = await subscriptionsRepo.getSubscriptionByBusinessId(db, session.businessId);

    const result = await providerCreateCheckoutSession({
      mode: "subscription",
      priceId,
      customerId: existing?.billingCustomerId,
      customerEmail: existing?.billingCustomerId ? undefined : business.email,
      trialDays: TRIAL_DAYS,
      successUrl: urls.successUrl,
      cancelUrl: urls.cancelUrl,
      metadata: { businessId: session.businessId, planId: plan.id },
      idempotencyKey: checkoutIdempotencyKey("subscription", session.businessId, existing?.updatedAt ?? "new"),
    });

    await subscriptionsRepo.upsertSubscription(db, session.businessId, {
      planId: plan.id,
      status: existing?.status ?? "incomplete",
      providerCheckoutSessionId: result.id,
    });

    return { url: result.url };
  } finally {
    endCheckout(session.businessId);
  }
}

/**
 * Creates a real Stripe Checkout session, in `payment` mode, for the
 * optional one-time professional installation fee — entirely separate
 * from the recurring subscription (see
 * docs/decisions/0018-stripe-v1-hardening.md). Reuses (rather than
 * duplicating) a `pending` charge from an earlier abandoned attempt;
 * refuses to start a new one once this business's installation charge has
 * already been resolved (`paid` or `waived`) so a business can't
 * accidentally pay twice or re-litigate a founder-waived fee.
 */
export async function createInstallationCheckoutSession(
  db: Queryable,
  session: AuthSession,
  urls: { successUrl: string; cancelUrl: string },
): Promise<{ url: string }> {
  // Registered synchronously, before the first `await` below — see
  // `createCheckoutSessionForPlan`'s identical comment above for why.
  beginCheckout(session.businessId);
  try {
    const business = await getBusinessById(db, session.businessId);
    if (!business) throw new Error("Business not found.");

    const existingCharge = await billingChargesRepo.getBillingChargeByKind(
      db,
      session.businessId,
      PROFESSIONAL_INSTALLATION_FEE.kind,
    );
    if (existingCharge && existingCharge.status !== "pending") {
      throw new Error("Installation has already been resolved for this business.");
    }
    const charge =
      existingCharge ??
      (await billingChargesRepo.createBillingCharge(db, session.businessId, {
        kind: PROFESSIONAL_INSTALLATION_FEE.kind,
        amountCents: PROFESSIONAL_INSTALLATION_FEE.amountCents,
        currency: PROFESSIONAL_INSTALLATION_FEE.currency,
      }));

    const existingSubscription = await subscriptionsRepo.getSubscriptionByBusinessId(db, session.businessId);

    const result = await providerCreateCheckoutSession({
      mode: "payment",
      priceId: resolveInstallationPriceId(),
      customerId: existingSubscription?.billingCustomerId,
      customerEmail: existingSubscription?.billingCustomerId ? undefined : business.email,
      successUrl: urls.successUrl,
      cancelUrl: urls.cancelUrl,
      // `kind` lets the webhook tell a subscription checkout apart from an
      // installation checkout without depending on Stripe's `mode` field;
      // `billingChargeId` is the trusted, unguessable reference the webhook
      // uses to find and update the exact right charge — never trusting a
      // client-suppliable businessId/amount at that point either.
      metadata: { businessId: session.businessId, billingChargeId: charge.id, kind: PROFESSIONAL_INSTALLATION_FEE.kind },
      idempotencyKey: checkoutIdempotencyKey("installation", session.businessId, charge.updatedAt),
    });

    return { url: result.url };
  } finally {
    endCheckout(session.businessId);
  }
}

/**
 * Records that a business chose to install the estimator itself, at no
 * cost — never creates a Stripe charge of any kind (see
 * docs/decisions/0018: "do not create fake $0 Stripe payments unless
 * there is a concrete reason"). Recorded as an immediately-`waived`,
 * $0 `billing_charges` row purely so the dashboard has one durable place
 * to show "you chose self-install" and doesn't re-prompt — refuses if this
 * business's installation choice has already been resolved either way.
 */
export async function chooseSelfInstall(db: Queryable, session: AuthSession): Promise<BillingCharge> {
  const existing = await billingChargesRepo.getBillingChargeByKind(db, session.businessId, PROFESSIONAL_INSTALLATION_FEE.kind);
  if (existing) {
    throw new Error("Installation has already been resolved for this business.");
  }
  return billingChargesRepo.createBillingCharge(db, session.businessId, {
    kind: PROFESSIONAL_INSTALLATION_FEE.kind,
    amountCents: 0,
    currency: PROFESSIONAL_INSTALLATION_FEE.currency,
    status: "waived",
  });
}

/**
 * Creates a Stripe Customer Portal session so a business can manage its
 * own billing (update card, view invoices, cancel, switch plans) —
 * Stripe-hosted, no custom UI (see docs/decisions/0018). Requires a real
 * Stripe Customer to already exist, which only happens once this business
 * has gone through Checkout at least once; there's deliberately no
 * fallback that creates a bare Customer just to open the portal, since a
 * business with no billing history has nothing to manage yet.
 */
export async function createBillingPortalSession(
  db: Queryable,
  session: AuthSession,
  returnUrl: string,
): Promise<{ url: string }> {
  const subscription = await subscriptionsRepo.getSubscriptionByBusinessId(db, session.businessId);
  if (!subscription?.billingCustomerId) {
    throw new Error("No billing account yet — start checkout before managing billing.");
  }
  const result = await providerCreatePortalSession({ customerId: subscription.billingCustomerId, returnUrl });
  return { url: result.url };
}
