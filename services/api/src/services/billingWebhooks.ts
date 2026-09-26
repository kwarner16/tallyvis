import type { Queryable } from "../db/pg/client";
import { verifyStripeWebhookSignature } from "../billing/verifyWebhookSignature";
import { resolvePlanIdFromPriceId } from "../billing";
import type { StripeSubscriptionObject } from "../billing/types";
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

/** Shared with `subscriptions.ts`'s Stripe reconciliation path — the same Stripe-status → internal-status mapping every webhook branch already uses. */
export function mapStripeSubscriptionStatus(stripeStatus: string): SubscriptionStatus {
  return STRIPE_TO_INTERNAL_STATUS[stripeStatus] ?? "incomplete";
}

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
 * Pure mapping from a Stripe subscription object to this app's own patch
 * fields — extracted so the exact same field-by-field translation (status
 * mapping, plan resolution, and the cancellation-state clearing rules) is
 * used whether the object arrived via a live webhook event or a direct
 * Stripe API fetch (reconciliation). Does NOT include `businessId`,
 * `providerSubscriptionId` backfill, or `lastWebhookEventId`/
 * `lastWebhookEventCreatedAt` — those depend on the caller's context
 * (an event vs. a plain fetch) and are added by each caller.
 */
export interface SubscriptionPatchFromStripe {
  /** `undefined` when the price on the subscription doesn't resolve to a known plan (foreign/stale data) — callers should fall back to the existing stored planId in that case. */
  resolvedPlanId: ReturnType<typeof resolvePlanIdFromPriceId>;
  status: SubscriptionStatus;
  trialStartedAt?: string;
  trialEndsAt?: string;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  canceledAt?: string;
  clearCanceledAt: boolean;
  cancelAtPeriodEnd?: boolean;
  cancelAt?: string;
}

export function buildSubscriptionPatchFromStripe(
  stripeSub: StripeSubscriptionObject,
  forcedStatus?: SubscriptionStatus,
): SubscriptionPatchFromStripe {
  const status: SubscriptionStatus = forcedStatus ?? mapStripeSubscriptionStatus(stripeSub.status);

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

  // Same "only act when the payload actually has an opinion" rule as
  // `cancel_at_period_end` above, applied to `canceled_at` — real Stripe
  // subscription objects always include this key (as a number or `null`).
  // A `.deleted` event's genuinely-truthy `canceled_at` is set normally;
  // otherwise, when the field is present and falsy, it must be explicitly
  // CLEARED (not just left alone) — Stripe itself clears `canceled_at` on
  // reactivation, and without this a subscription that was scheduled to
  // cancel and then reactivated would keep showing the stale original
  // cancellation timestamp forever, since plain COALESCE(NULL, existing)
  // can never express "clear this" (2026-09 incident audit — found via a
  // real production subscription stuck exactly this way).
  const canceledAt = stripeSub.canceled_at ? new Date(stripeSub.canceled_at * 1000).toISOString() : undefined;
  const clearCanceledAt = forcedStatus !== "canceled" && "canceled_at" in stripeSub && !stripeSub.canceled_at;

  return {
    resolvedPlanId,
    status,
    trialStartedAt: stripeSub.trial_start ? new Date(stripeSub.trial_start * 1000).toISOString() : undefined,
    trialEndsAt: stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000).toISOString() : undefined,
    currentPeriodStart: stripeSub.current_period_start
      ? new Date(stripeSub.current_period_start * 1000).toISOString()
      : undefined,
    currentPeriodEnd: stripeSub.current_period_end
      ? new Date(stripeSub.current_period_end * 1000).toISOString()
      : undefined,
    canceledAt,
    clearCanceledAt,
    cancelAtPeriodEnd,
    cancelAt,
  };
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
  const stripeSub = event.data.object as unknown as StripeSubscriptionObject;

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

  const patch = buildSubscriptionPatchFromStripe(stripeSub, forcedStatus);

  await subscriptionsRepo.upsertSubscription(db, existing.businessId, {
    planId: patch.resolvedPlanId ?? existing.planId,
    status: patch.status,
    // Only set when this event was resolved via the metadata fallback
    // above (the normal id-lookup path already found this row BY its
    // provider_subscription_id, so it's already correct and this is
    // omitted to avoid a redundant write) — backfills the column so
    // every later event for this same subscription is found directly.
    providerSubscriptionId: foundByMetadataFallback ? stripeSub.id : undefined,
    // Backfills `billing_customer_id` from ANY subscription-lifecycle
    // event whenever it's still missing locally — not gated on
    // `foundByMetadataFallback` like `providerSubscriptionId` above,
    // because this gap is broader: `billing_customer_id` is otherwise
    // ONLY ever set by `checkout.session.completed`, so if that one
    // specific event is ever permanently lost or delayed indefinitely
    // (the same class of gap this whole incident is about) while
    // subscription.created/.updated events land fine, the local row would
    // stay missing a Customer id forever even though a real Stripe
    // Customer + subscription genuinely exist — and
    // `createCheckoutSessionForPlan`'s duplicate-subscription guard reads
    // exactly this field to decide whether to refuse a second checkout.
    // Found live during this incident's own production webhook
    // acceptance test (2026-09 audit), not by inspection.
    billingCustomerId: existing.billingCustomerId ? undefined : stripeSub.customer,
    trialStartedAt: patch.trialStartedAt,
    trialEndsAt: patch.trialEndsAt,
    currentPeriodStart: patch.currentPeriodStart,
    currentPeriodEnd: patch.currentPeriodEnd,
    canceledAt: patch.canceledAt,
    clearCanceledAt: patch.clearCanceledAt,
    cancelAtPeriodEnd: patch.cancelAtPeriodEnd,
    cancelAt: patch.cancelAt,
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
