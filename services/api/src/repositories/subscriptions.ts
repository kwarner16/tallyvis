import type { DatabaseSync } from "node:sqlite";
import { makeId } from "../db/ids";

/**
 * Phase 14 — SaaS plan/trial/subscription foundation (see
 * docs/decisions/0016-onboarding-billing-embed.md). One row per business
 * (its CURRENT billing state, not a history of every change), designed to
 * be reconciled against a real billing provider (Stripe) later —
 * `billingCustomerId`/`providerSubscriptionId`/`providerCheckoutSessionId`
 * are exactly the identifiers a webhook handler needs to keep this row in
 * sync, never a second source of truth Stripe's own dashboard would
 * disagree with.
 */

export type SubscriptionStatus = "trialing" | "active" | "canceled" | "expired" | "incomplete";

export interface Subscription {
  id: string;
  businessId: string;
  planId: string;
  status: SubscriptionStatus;
  trialStartedAt?: string;
  trialEndsAt?: string;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  billingCustomerId?: string;
  providerSubscriptionId?: string;
  providerCheckoutSessionId?: string;
  canceledAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface SubscriptionRow {
  id: string;
  business_id: string;
  plan_id: string;
  status: string;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  billing_customer_id: string | null;
  provider_subscription_id: string | null;
  provider_checkout_session_id: string | null;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
}

function toSubscription(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    businessId: row.business_id,
    planId: row.plan_id,
    status: row.status as SubscriptionStatus,
    trialStartedAt: row.trial_started_at ?? undefined,
    trialEndsAt: row.trial_ends_at ?? undefined,
    currentPeriodStart: row.current_period_start ?? undefined,
    currentPeriodEnd: row.current_period_end ?? undefined,
    billingCustomerId: row.billing_customer_id ?? undefined,
    providerSubscriptionId: row.provider_subscription_id ?? undefined,
    providerCheckoutSessionId: row.provider_checkout_session_id ?? undefined,
    canceledAt: row.canceled_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getSubscriptionByBusinessId(db: DatabaseSync, businessId: string): Subscription | undefined {
  const row = db.prepare(`SELECT * FROM subscriptions WHERE business_id = ?`).get(businessId) as
    | SubscriptionRow
    | undefined;
  return row ? toSubscription(row) : undefined;
}

export interface UpsertSubscriptionInput {
  planId: string;
  status: SubscriptionStatus;
  trialStartedAt?: string;
  trialEndsAt?: string;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  billingCustomerId?: string;
  providerSubscriptionId?: string;
  providerCheckoutSessionId?: string;
  canceledAt?: string;
}

/** Inserts this business's subscription row, or fully replaces its editable fields if one already exists — a business has at most one subscription row, ever (see the table's UNIQUE constraint on business_id). */
export function upsertSubscription(
  db: DatabaseSync,
  businessId: string,
  input: UpsertSubscriptionInput,
): Subscription {
  const now = new Date().toISOString();
  const existing = getSubscriptionByBusinessId(db, businessId);

  if (existing) {
    db.prepare(
      `UPDATE subscriptions SET
         plan_id = ?, status = ?, trial_started_at = ?, trial_ends_at = ?,
         current_period_start = ?, current_period_end = ?, billing_customer_id = ?,
         provider_subscription_id = ?, provider_checkout_session_id = ?, canceled_at = ?, updated_at = ?
       WHERE business_id = ?`,
    ).run(
      input.planId,
      input.status,
      input.trialStartedAt ?? null,
      input.trialEndsAt ?? null,
      input.currentPeriodStart ?? null,
      input.currentPeriodEnd ?? null,
      input.billingCustomerId ?? null,
      input.providerSubscriptionId ?? null,
      input.providerCheckoutSessionId ?? null,
      input.canceledAt ?? null,
      now,
      businessId,
    );
  } else {
    db.prepare(
      `INSERT INTO subscriptions (
         id, business_id, plan_id, status, trial_started_at, trial_ends_at,
         current_period_start, current_period_end, billing_customer_id,
         provider_subscription_id, provider_checkout_session_id, canceled_at,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      makeId("subscription"),
      businessId,
      input.planId,
      input.status,
      input.trialStartedAt ?? null,
      input.trialEndsAt ?? null,
      input.currentPeriodStart ?? null,
      input.currentPeriodEnd ?? null,
      input.billingCustomerId ?? null,
      input.providerSubscriptionId ?? null,
      input.providerCheckoutSessionId ?? null,
      input.canceledAt ?? null,
      now,
      now,
    );
  }

  const saved = getSubscriptionByBusinessId(db, businessId);
  if (!saved) throw new Error("Failed to read back the subscription that was just saved.");
  return saved;
}

/** Looked up by the Stripe webhook handler, which knows the provider's own subscription id, not our internal businessId. */
export function getSubscriptionByProviderSubscriptionId(
  db: DatabaseSync,
  providerSubscriptionId: string,
): Subscription | undefined {
  const row = db.prepare(`SELECT * FROM subscriptions WHERE provider_subscription_id = ?`).get(
    providerSubscriptionId,
  ) as SubscriptionRow | undefined;
  return row ? toSubscription(row) : undefined;
}
