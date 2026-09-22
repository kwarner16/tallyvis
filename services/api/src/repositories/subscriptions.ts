import { makeId } from "../db/ids";
import type { Queryable } from "../db/pg/client";

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
  /** True when Stripe reports this subscription is scheduled to cancel at the end of the current period — still `trialing`/`active` (access unaffected) until `cancel_at` actually passes. See db/pg/migrations/0004_accounts_billing.sql. */
  cancelAtPeriodEnd: boolean;
  /** When the scheduled cancellation above will actually take effect — only meaningful while `cancelAtPeriodEnd` is true; cleared (undefined) once reactivated or once the subscription has actually ended. */
  cancelAt?: string;
  /** The most recently APPLIED Stripe webhook event's id — used to recognize and skip an exact replay of an already-processed event (Stripe explicitly documents at-least-once delivery). */
  lastWebhookEventId?: string;
  /** The most recently APPLIED Stripe webhook event's `created` (Unix seconds) — used to reject a late-arriving, OLDER, DISTINCT event from overwriting newer state. */
  lastWebhookEventCreatedAt?: number;
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
  cancel_at_period_end: boolean;
  cancel_at: string | null;
  last_webhook_event_id: string | null;
  last_webhook_event_created_at: number | null;
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
    cancelAtPeriodEnd: row.cancel_at_period_end,
    cancelAt: row.cancel_at ?? undefined,
    lastWebhookEventId: row.last_webhook_event_id ?? undefined,
    lastWebhookEventCreatedAt: row.last_webhook_event_created_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getSubscriptionByBusinessId(db: Queryable, businessId: string): Promise<Subscription | undefined> {
  const result = await db.query<SubscriptionRow>(`SELECT * FROM subscriptions WHERE business_id = $1`, [businessId]);
  const row = result.rows[0];
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
  /**
   * Unlike every other optional field above, omitting this does NOT mean
   * "preserve the existing value" when `cancelAt` is also omitted — see
   * this function's own comment for why a plain COALESCE can't correctly
   * express "clear cancel_at because cancellation was just reactivated."
   * Pass `false` explicitly (from `applyStripeSubscription`, which always
   * knows Stripe's current truth for this field) to clear it; omit both
   * fields entirely (from callers with no opinion, e.g. `startTrial`) to
   * leave whatever was already stored untouched.
   */
  cancelAtPeriodEnd?: boolean;
  cancelAt?: string;
  lastWebhookEventId?: string;
  lastWebhookEventCreatedAt?: number;
}

/**
 * Inserts this business's subscription row, or updates one that already
 * exists — a business has at most one subscription row, ever (see the
 * table's UNIQUE constraint on business_id). `planId`/`status` are always
 * set explicitly (required fields); every other, OPTIONAL field is a true
 * partial patch on the update path via `COALESCE` — omitting one (passing
 * `undefined`) leaves the existing stored value untouched rather than
 * nulling it out, the same pattern `recordQuoteViewed` in
 * `repositories/quotes.ts` already uses for the same reason.
 */
export async function upsertSubscription(
  db: Queryable,
  businessId: string,
  input: UpsertSubscriptionInput,
): Promise<Subscription> {
  const now = new Date().toISOString();
  const existing = await getSubscriptionByBusinessId(db, businessId);

  // `cancel_at_period_end` uses COALESCE like everything else — omitting it
  // preserves the existing value. `cancel_at` is different: when the
  // caller explicitly passes `cancelAtPeriodEnd: false` (Stripe reporting
  // cancellation was reactivated/removed), `cancel_at` must be CLEARED to
  // NULL, which a plain COALESCE($1, cancel_at) can never do (COALESCE(NULL, x)
  // returns x, not NULL) — hence the CASE. A real boolean (or NULL) is
  // bound twice (once for its own column, once for this CASE's condition)
  // — Postgres's three-valued NULL/FALSE/TRUE comparison logic is
  // identical to SQLite's here, so the CASE's behavior is unchanged, only
  // the bound value's type changed from 0/1/null to false/true/null.
  const cancelAtPeriodEndParam = input.cancelAtPeriodEnd === undefined ? null : input.cancelAtPeriodEnd;

  if (existing) {
    await db.query(
      `UPDATE subscriptions SET
         plan_id = $1, status = $2,
         trial_started_at = COALESCE($3, trial_started_at),
         trial_ends_at = COALESCE($4, trial_ends_at),
         current_period_start = COALESCE($5, current_period_start),
         current_period_end = COALESCE($6, current_period_end),
         billing_customer_id = COALESCE($7, billing_customer_id),
         provider_subscription_id = COALESCE($8, provider_subscription_id),
         provider_checkout_session_id = COALESCE($9, provider_checkout_session_id),
         canceled_at = COALESCE($10, canceled_at),
         cancel_at_period_end = COALESCE($11, cancel_at_period_end),
         cancel_at = CASE WHEN $11 = FALSE THEN NULL ELSE COALESCE($12, cancel_at) END,
         last_webhook_event_id = COALESCE($13, last_webhook_event_id),
         last_webhook_event_created_at = COALESCE($14, last_webhook_event_created_at),
         updated_at = $15
       WHERE business_id = $16`,
      [
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
        cancelAtPeriodEndParam,
        input.cancelAt ?? null,
        input.lastWebhookEventId ?? null,
        input.lastWebhookEventCreatedAt ?? null,
        now,
        businessId,
      ],
    );
  } else {
    await db.query(
      `INSERT INTO subscriptions (
         id, business_id, plan_id, status, trial_started_at, trial_ends_at,
         current_period_start, current_period_end, billing_customer_id,
         provider_subscription_id, provider_checkout_session_id, canceled_at,
         cancel_at_period_end, cancel_at,
         last_webhook_event_id, last_webhook_event_created_at, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
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
        cancelAtPeriodEndParam ?? false,
        input.cancelAt ?? null,
        input.lastWebhookEventId ?? null,
        input.lastWebhookEventCreatedAt ?? null,
        now,
        now,
      ],
    );
  }

  const saved = await getSubscriptionByBusinessId(db, businessId);
  if (!saved) throw new Error("Failed to read back the subscription that was just saved.");
  return saved;
}

/** Looked up by the Stripe webhook handler, which knows the provider's own subscription id, not our internal businessId. */
export async function getSubscriptionByProviderSubscriptionId(
  db: Queryable,
  providerSubscriptionId: string,
): Promise<Subscription | undefined> {
  const result = await db.query<SubscriptionRow>(
    `SELECT * FROM subscriptions WHERE provider_subscription_id = $1`,
    [providerSubscriptionId],
  );
  const row = result.rows[0];
  return row ? toSubscription(row) : undefined;
}
