import type { Queryable } from "../db/pg/client";
import { verifyStripeWebhookSignature } from "../billing/verifyWebhookSignature";
import { resolvePlanIdFromPriceId } from "../billing";
import * as subscriptionsRepo from "../repositories/subscriptions";
import type { Subscription, SubscriptionStatus } from "../repositories/subscriptions";
import * as billingChargesRepo from "../repositories/billingCharges";

/**
 * Phase 14 — reconciling internal subscription state against Stripe's own
 * (see docs/decisions/0016-onboarding-billing-embed.md), hardened for V1 in
 * docs/decisions/0018-stripe-v1-hardening.md: fixes a status-mapping bug,
 * adds `customer.subscription.created` handling, adds out-of-order event
 * protection, and reconciles the one-time installation Checkout alongside
 * the recurring subscription Checkout.
 */

const STRIPE_TO_INTERNAL_STATUS: Record<string, SubscriptionStatus> = {
  trialing: "trialing",
  active: "active",
  past_due: "active", // still has access during Stripe's own dunning/grace period — see subscriptions.ts's hasProductAccess comment
  canceled: "canceled",
  unpaid: "expired",
  incomplete: "incomplete",
  incomplete_expired: "expired",
  paused: "expired",
};

export class WebhookVerificationError extends Error {}

interface StripeEvent {
  /** Stripe's own event id (e.g. "evt_..."), used for replay/idempotency detection below. Absent only in hand-built test payloads that don't care about idempotency; real Stripe events always include it. */
  id?: string;
  /** Unix seconds Stripe assigned when the event was generated — used for out-of-order protection below. Absent only in hand-built test payloads that don't exercise that path. */
  created?: number;
  type: string;
  data: { object: Record<string, unknown> };
}

/**
 * True if `event` should be skipped: either an exact replay of the most
 * recently applied event (Stripe explicitly documents at-least-once
 * delivery), or a distinct but OLDER event arriving out of order after a
 * newer one was already applied to this row. The second check is what
 * lets this reject a late-arriving, out-of-order DIFFERENT event, not just
 * a byte-for-byte replay of the last one — see
 * docs/decisions/0018-stripe-v1-hardening.md for why this was added and
 * why it's a small, targeted fix rather than a full ordered-event-log.
 */
function isStaleOrReplayed(event: StripeEvent, existing: Subscription | undefined): boolean {
  if (!existing) return false;
  if (event.id && existing.lastWebhookEventId === event.id) return true;
  if (event.created !== undefined && existing.lastWebhookEventCreatedAt !== undefined) {
    if (event.created < existing.lastWebhookEventCreatedAt) return true;
  }
  return false;
}

/** Shared by `customer.subscription.created`/`.updated`/`.deleted` — the only difference between them is where `status` comes from. */
async function applyStripeSubscription(db: Queryable, event: StripeEvent, forcedStatus?: SubscriptionStatus): Promise<void> {
  const stripeSub = event.data.object as {
    id: string;
    status: string;
    current_period_start?: number;
    current_period_end?: number;
    canceled_at?: number | null;
    trial_start?: number | null;
    trial_end?: number | null;
    cancel_at_period_end?: boolean;
    cancel_at?: number | null;
    items?: { data?: Array<{ price?: { id?: string } }> };
    metadata?: { businessId?: string };
  };

  // Stripe does not guarantee delivery order ACROSS event types — only
  // same-object events are (best-effort) ordered — so this event can
  // legitimately arrive before the `checkout.session.completed` handler
  // has had a chance to backfill `provider_subscription_id` onto the
  // row. Without this fallback, that race permanently drops the event
  // (silently returning below) and the subscription is stuck at
  // whatever status `createCheckoutSessionForPlan` initialized it to —
  // exactly the "Stripe says trialing, TallyVis says incomplete" bug
  // this fixes (2026-09 incident). `subscription_data.metadata` is set
  // on every Checkout-created subscription (see
  // billing/providers/stripe.ts), so it's always available here as a
  // second, reliable way to find the right row — `providerSubscriptionId`
  // is passed through explicitly below so this row is found directly by
  // id on every subsequent event, not just future ones that happen to
  // repeat the fallback.
  let existing = await subscriptionsRepo.getSubscriptionByProviderSubscriptionId(db, stripeSub.id);
  let foundByMetadataFallback = false;
  if (!existing && stripeSub.metadata?.businessId) {
    existing = await subscriptionsRepo.getSubscriptionByBusinessId(db, stripeSub.metadata.businessId);
    foundByMetadataFallback = existing !== undefined;
  }
  if (!existing) return;
  if (isStaleOrReplayed(event, existing)) return;

  const status: SubscriptionStatus = forcedStatus ?? (STRIPE_TO_INTERNAL_STATUS[stripeSub.status] ?? "incomplete");

  // A Customer Portal plan switch changes the subscription's Stripe Price,
  // not anything Tallyvis-initiated — resolve it back to our own planId so
  // `subscriptions.plan_id` stays in sync after a portal-driven
  // upgrade/downgrade, not just after a Tallyvis-initiated Checkout. An
  // unrecognized price (foreign data, or this environment's config
  // doesn't have it) leaves the existing planId untouched.
  const newPriceId = stripeSub.items?.data?.[0]?.price?.id;
  const resolvedPlanId = newPriceId ? resolvePlanIdFromPriceId(newPriceId) : undefined;

  // `.deleted` means the subscription has ACTUALLY ended — that supersedes
  // any "scheduled to cancel" state regardless of what this particular
  // payload says, so it's forced to false/cleared. Otherwise, only treat
  // `cancel_at_period_end` as known when the payload actually includes the
  // property (real Stripe events always do; a hand-built test payload may
  // not) — passing `undefined` when it's genuinely absent lets the
  // repository's COALESCE preserve whatever was already stored, rather
  // than this defaulting a missing field to "not scheduled" and silently
  // clearing a real scheduled cancellation. When it IS present, pass the
  // real current value through unconditionally (even `false`) so a
  // portal-driven reactivation correctly clears `cancel_at` too — see
  // repositories/subscriptions.ts's upsertSubscription for why this field
  // can't use plain COALESCE-preserve semantics like the others below.
  const cancelAtPeriodEnd =
    forcedStatus === "canceled"
      ? false
      : "cancel_at_period_end" in stripeSub
        ? Boolean(stripeSub.cancel_at_period_end)
        : undefined;
  const cancelAt =
    forcedStatus === "canceled" || !stripeSub.cancel_at
      ? undefined
      : new Date(stripeSub.cancel_at * 1000).toISOString();

  await subscriptionsRepo.upsertSubscription(db, existing.businessId, {
    planId: resolvedPlanId ?? existing.planId,
    status,
    // Only set when this event was resolved via the metadata fallback
    // above (the normal id-lookup path already found this row BY its
    // provider_subscription_id, so it's already correct and this is
    // omitted to avoid a redundant write) — backfills the column so
    // every later event for this same subscription is found directly.
    providerSubscriptionId: foundByMetadataFallback ? stripeSub.id : undefined,
    trialStartedAt: stripeSub.trial_start ? new Date(stripeSub.trial_start * 1000).toISOString() : undefined,
    trialEndsAt: stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000).toISOString() : undefined,
    currentPeriodStart: stripeSub.current_period_start
      ? new Date(stripeSub.current_period_start * 1000).toISOString()
      : undefined,
    currentPeriodEnd: stripeSub.current_period_end
      ? new Date(stripeSub.current_period_end * 1000).toISOString()
      : undefined,
    canceledAt: stripeSub.canceled_at ? new Date(stripeSub.canceled_at * 1000).toISOString() : undefined,
    cancelAtPeriodEnd,
    cancelAt,
    lastWebhookEventId: event.id,
    lastWebhookEventCreatedAt: event.created,
  });
}

/**
 * Verifies the signature (throwing `WebhookVerificationError` if it
 * doesn't check out — the caller must respond with a non-2xx status, never
 * process an unverified payload) and applies the subset of Stripe
 * lifecycle events this app actually needs to stay in sync. See this
 * file's own comments on each branch for exactly what's handled and why.
 */
export async function handleStripeWebhook(
  db: Queryable,
  rawBody: string,
  signatureHeader: string,
  webhookSecret: string,
): Promise<void> {
  if (!verifyStripeWebhookSignature(rawBody, signatureHeader, webhookSecret)) {
    throw new WebhookVerificationError("Stripe webhook signature verification failed.");
  }

  const event = JSON.parse(rawBody) as StripeEvent;

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as {
      customer?: string;
      subscription?: string;
      payment_intent?: string;
      metadata?: { businessId?: string; planId?: string; billingChargeId?: string };
    };

    // A `payment`-mode session is the one-time installation fee — entirely
    // separate from `subscriptions` (see
    // docs/decisions/0018-stripe-v1-hardening.md). Resolved by the
    // unguessable `billingChargeId` round-tripped through metadata, with a
    // businessId cross-check as defense in depth — never by trusting a
    // client-suppliable businessId/amount at this point.
    if (session.metadata?.billingChargeId) {
      const charge = await billingChargesRepo.getBillingChargeById(db, session.metadata.billingChargeId);
      if (!charge || charge.businessId !== session.metadata.businessId) return; // Not ours, or tampered metadata.
      if (charge.status !== "pending") return; // Already resolved — also covers an exact webhook replay.
      await billingChargesRepo.markBillingChargeStatus(db, charge.id, "paid", session.payment_intent);
      return;
    }

    const businessId = session.metadata?.businessId;
    if (!businessId) return; // Not one of ours (or malformed) — nothing to reconcile.

    const existing = await subscriptionsRepo.getSubscriptionByBusinessId(db, businessId);
    if (isStaleOrReplayed(event, existing)) return;

    // Deliberately does NOT set `status` to "active" (the bug this fixes —
    // see docs/decisions/0018): a completed Checkout session tells us a
    // real Stripe Customer/Subscription now exist, nothing about whether
    // that subscription is trialing or already active. The
    // near-simultaneous `customer.subscription.created` event (handled
    // below, via the same status-mapping table as `.updated`) supplies the
    // real status; until then this preserves whatever was already known
    // (typically "incomplete" from `createCheckoutSessionForPlan`).
    await subscriptionsRepo.upsertSubscription(db, businessId, {
      planId: session.metadata?.planId ?? existing?.planId ?? "starter",
      status: existing?.status ?? "incomplete",
      billingCustomerId: session.customer,
      providerSubscriptionId: session.subscription,
      lastWebhookEventId: event.id,
      lastWebhookEventCreatedAt: event.created,
    });
    return;
  }

  if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") {
    await applyStripeSubscription(db, event);
    return;
  }

  if (event.type === "customer.subscription.deleted") {
    await applyStripeSubscription(db, event, "canceled");
    return;
  }

  // `invoice.paid`/`invoice.payment_failed` are deliberately NOT handled:
  // `customer.subscription.updated` already delivers the resulting
  // trialing/active/past_due/canceled state whenever a payment succeeds or
  // fails (Stripe transitions the subscription's own status as part of
  // the same lifecycle event), so a dedicated handler here would only
  // duplicate a state transition this app already mirrors — see
  // docs/decisions/0018-stripe-v1-hardening.md. Smart Retries and Stripe's
  // own automated emails own the recovery workflow itself; Tallyvis's job
  // is only to reflect the resulting subscription state, which it already
  // does via the branch above. Any other event type (including this one)
  // is silently ignored — Stripe's own recommendation is to only process
  // events you act on, not every event type it can send.
}
