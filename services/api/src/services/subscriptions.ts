import type { DatabaseSync } from "node:sqlite";
import { getPlan, isPlanId, TRIAL_DAYS, WEBSITE_INSTALLATION_FEE } from "@tallyvis/config";
import type { AuthSession } from "../auth/session";
import * as subscriptionsRepo from "../repositories/subscriptions";
import type { Subscription, SubscriptionStatus } from "../repositories/subscriptions";
import * as billingChargesRepo from "../repositories/billingCharges";
import type { BillingCharge } from "../repositories/billingCharges";
import { getBusinessById } from "../repositories/businesses";
import { createCheckoutSession as providerCreateCheckoutSession, isBillingConfigured } from "../billing";

export type { Subscription, SubscriptionStatus } from "../repositories/subscriptions";
export type { BillingCharge } from "../repositories/billingCharges";

/**
 * Phase 14 — SaaS plan/trial/subscription foundation (see
 * docs/decisions/0016-onboarding-billing-embed.md).
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

export function getSubscription(db: DatabaseSync, session: AuthSession): Subscription | undefined {
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
 * "trialing" or "active."
 */
export function hasProductAccess(subscription: Subscription | undefined, now: number = Date.now()): boolean {
  if (!subscription) return true;
  const status = resolveEffectiveStatus(subscription, now);
  return status === "trialing" || status === "active";
}

/**
 * Starts (or restarts) a business's free trial for the given plan — the
 * self-serve path the brief's "select plan → start 7-day trial → product
 * access" flow describes, with no payment step. Also records the one-time
 * website-installation fee as a separate, pending billing concept (see
 * `@tallyvis/config`'s `WEBSITE_INSTALLATION_FEE`) the first time a
 * business reaches this point — never bundled into the recurring plan
 * price, and never actually charged by this function; see
 * docs/decisions/0016 for what this phase does and doesn't wire up to a
 * real charge.
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
export function startTrial(db: DatabaseSync, session: AuthSession, planId: string): Subscription {
  if (!isPlanId(planId)) {
    throw new Error(`Unknown plan "${planId}".`);
  }

  const existing = subscriptionsRepo.getSubscriptionByBusinessId(db, session.businessId);
  const alreadyEntitled = existing && (existing.status === "trialing" || existing.status === "active");

  const now = new Date();
  const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

  // Every field left out below is preserved as-is by `upsertSubscription`'s
  // COALESCE-based partial-patch update (see that function's own comment)
  // — no need to thread `existing?.X` through fields this function has no
  // opinion about, like a previously-linked Stripe customer/subscription id.
  const subscription = subscriptionsRepo.upsertSubscription(db, session.businessId, {
    planId,
    status: alreadyEntitled ? existing.status : "trialing",
    trialStartedAt: alreadyEntitled ? existing.trialStartedAt : now.toISOString(),
    trialEndsAt: alreadyEntitled ? existing.trialEndsAt : trialEndsAt.toISOString(),
  });

  if (!billingChargesRepo.getBillingChargeByKind(db, session.businessId, WEBSITE_INSTALLATION_FEE.kind)) {
    billingChargesRepo.createBillingCharge(db, session.businessId, {
      kind: WEBSITE_INSTALLATION_FEE.kind,
      amountCents: WEBSITE_INSTALLATION_FEE.amountCents,
      currency: WEBSITE_INSTALLATION_FEE.currency,
    });
  }

  return subscription;
}

export function listBillingCharges(db: DatabaseSync, session: AuthSession): BillingCharge[] {
  return billingChargesRepo.listBillingCharges(db, session.businessId);
}

export function billingConfigured(): boolean {
  return isBillingConfigured();
}

/**
 * Creates a real Stripe Checkout session for this business's chosen plan —
 * only reachable when Stripe is actually configured (`STRIPE_SECRET_KEY`
 * set); throws a `BillingProviderError` categorized `"not-configured"`
 * otherwise, which the UI renders as an honest message rather than a
 * button that fails silently. The session id is stored on the
 * subscription row immediately (so a webhook can later resolve which
 * business a completed checkout belongs to via `metadata.businessId`
 * as well); the subscription's `status` itself is only changed once the
 * webhook confirms the checkout actually completed — this function alone
 * never marks a business as paying.
 */
export async function createCheckoutSessionForPlan(
  db: DatabaseSync,
  session: AuthSession,
  planId: string,
  urls: { successUrl: string; cancelUrl: string },
): Promise<{ url: string }> {
  const plan = getPlan(planId);
  if (!plan) throw new Error(`Unknown plan "${planId}".`);

  const business = getBusinessById(db, session.businessId);
  if (!business) throw new Error("Business not found.");

  const result = await providerCreateCheckoutSession({
    customerEmail: business.email,
    planId: plan.id,
    planName: plan.name,
    monthlyPriceCents: plan.monthlyPriceCents,
    trialDays: TRIAL_DAYS,
    successUrl: urls.successUrl,
    cancelUrl: urls.cancelUrl,
    metadata: { businessId: session.businessId, planId: plan.id },
  });

  // As with `startTrial`, every field left out here is preserved as-is by
  // `upsertSubscription`'s partial-patch update — only `planId`/`status`
  // (always required) and the freshly-created checkout session id change.
  const existing = subscriptionsRepo.getSubscriptionByBusinessId(db, session.businessId);
  subscriptionsRepo.upsertSubscription(db, session.businessId, {
    planId: plan.id,
    status: existing?.status ?? "incomplete",
    providerCheckoutSessionId: result.id,
  });

  return { url: result.url };
}
