import type { DatabaseSync } from "node:sqlite";
import { verifyStripeWebhookSignature } from "../billing/verifyWebhookSignature";
import * as subscriptionsRepo from "../repositories/subscriptions";
import type { SubscriptionStatus } from "../repositories/subscriptions";

/**
 * Phase 14 — reconciling internal subscription state against Stripe's own
 * (see docs/decisions/0016-onboarding-billing-embed.md). This is the
 * ARCHITECTURE for keeping `subscriptions` in sync with what Stripe
 * actually reports — unexercised against a real Stripe webhook in this
 * environment (no `STRIPE_WEBHOOK_SECRET` configured here), so treat this
 * as correctness-against-Stripe's-documented-payload-shape, not as a
 * verified live integration.
 */

const STRIPE_TO_INTERNAL_STATUS: Record<string, SubscriptionStatus> = {
  trialing: "trialing",
  active: "active",
  past_due: "active", // still has access during Stripe's own dunning/grace period
  canceled: "canceled",
  unpaid: "expired",
  incomplete: "incomplete",
  incomplete_expired: "expired",
  paused: "expired",
};

export class WebhookVerificationError extends Error {}

interface StripeEvent {
  /** Stripe's own event id (e.g. "evt_..."), used for replay/idempotency detection below — see `lastWebhookEventId`. Absent only in hand-built test payloads that don't care about idempotency; real Stripe events always include it. */
  id?: string;
  type: string;
  data: { object: Record<string, unknown> };
}

/**
 * Verifies the signature (throwing `WebhookVerificationError` if it
 * doesn't check out — the caller must respond with a non-2xx status, never
 * process an unverified payload) and applies the subset of Stripe
 * subscription lifecycle events this phase actually needs to stay in
 * sync: a completed checkout activates the subscription; Stripe's own
 * subscription updates/cancellation events keep status current after
 * that.
 *
 * Idempotency: Stripe explicitly documents at-least-once webhook delivery
 * — the same event can be (and, on any delivery hiccup, will be) sent
 * more than once. Each branch below checks the target subscription's
 * `lastWebhookEventId` before applying anything; an exact replay of the
 * event most recently applied to that row is recognized and skipped. This
 * guards against reapplying the same event twice, not against
 * out-of-order delivery of DIFFERENT events — a documented, deliberate
 * scope limit (see docs/decisions/0017-billing-hardening.md).
 */
export function handleStripeWebhook(
  db: DatabaseSync,
  rawBody: string,
  signatureHeader: string,
  webhookSecret: string,
): void {
  if (!verifyStripeWebhookSignature(rawBody, signatureHeader, webhookSecret)) {
    throw new WebhookVerificationError("Stripe webhook signature verification failed.");
  }

  const event = JSON.parse(rawBody) as StripeEvent;

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as {
      customer?: string;
      subscription?: string;
      metadata?: { businessId?: string; planId?: string };
    };
    const businessId = session.metadata?.businessId;
    if (!businessId) return; // Not one of ours (or malformed) — nothing to reconcile.

    const existing = subscriptionsRepo.getSubscriptionByBusinessId(db, businessId);
    if (event.id && existing?.lastWebhookEventId === event.id) return; // Exact replay — already applied.

    subscriptionsRepo.upsertSubscription(db, businessId, {
      planId: session.metadata?.planId ?? existing?.planId ?? "starter",
      status: "active",
      billingCustomerId: session.customer,
      providerSubscriptionId: session.subscription,
      lastWebhookEventId: event.id,
    });
    return;
  }

  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const stripeSub = event.data.object as {
      id: string;
      status: string;
      current_period_start?: number;
      current_period_end?: number;
      canceled_at?: number | null;
    };
    const existing = subscriptionsRepo.getSubscriptionByProviderSubscriptionId(db, stripeSub.id);
    if (!existing) return;
    if (event.id && existing.lastWebhookEventId === event.id) return; // Exact replay — already applied.

    const status: SubscriptionStatus =
      event.type === "customer.subscription.deleted"
        ? "canceled"
        : (STRIPE_TO_INTERNAL_STATUS[stripeSub.status] ?? "incomplete");

    subscriptionsRepo.upsertSubscription(db, existing.businessId, {
      planId: existing.planId,
      status,
      currentPeriodStart: stripeSub.current_period_start
        ? new Date(stripeSub.current_period_start * 1000).toISOString()
        : undefined,
      currentPeriodEnd: stripeSub.current_period_end
        ? new Date(stripeSub.current_period_end * 1000).toISOString()
        : undefined,
      canceledAt: stripeSub.canceled_at ? new Date(stripeSub.canceled_at * 1000).toISOString() : undefined,
      lastWebhookEventId: event.id,
    });
  }
}
