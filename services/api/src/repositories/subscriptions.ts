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
  /**
   * The raw Stripe Subscription status string as Stripe itself sent it
   * (e.g. "active", "past_due", "trialing", "canceled", "unpaid",
   * "incomplete", "incomplete_expired", "paused") — see
   * docs/decisions/0036-subscription-provider-status.md. Deliberately
   * SEPARATE from `status` above: `status` is TallyVis's own entitlement
   * signal (what access this gets), this is the billing-health fact of
   * record (what Stripe actually reported). `past_due` maps to `status
   * === "active"` for entitlement purposes, but `providerStatus` still
   * says `"past_due"` — this is what lets the admin dashboard truthfully
   * distinguish the two. `undefined` means Stripe's raw status for this
   * row isn't known yet — either a legacy row that predates this field
   * (never fabricated/backfilled; see the migration's own comment), or a
   * subscription created via `startTrial`'s DB-only path, which has no
   * real Stripe object to report a status from.
   */
  providerStatus?: string;
  trialStartedAt?: string;
  trialEndsAt?: string;
  /**
   * Permanent, one-time marker: when this business was FIRST EVER granted
   * a free trial — see docs/decisions/0034-trial-eligibility.md. Unlike
   * `trialStartedAt` (which reflects the most recent trial and would be
   * overwritten by a second one), this is set exactly once and never
   * cleared or overwritten again, by any code path, regardless of
   * cancellation, subscription deletion, or resubscription. Absent means
   * this business has never been granted a trial.
   */
  trialUsedAt?: string;
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
  provider_status: string | null;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  trial_used_at: string | null;
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
    providerStatus: row.provider_status ?? undefined,
    trialStartedAt: row.trial_started_at ?? undefined,
    trialEndsAt: row.trial_ends_at ?? undefined,
    trialUsedAt: row.trial_used_at ?? undefined,
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
  /** See `Subscription.providerStatus`'s own comment. COALESCE-preserve like every other field here — pass the raw Stripe status whenever it's genuinely known (from a real Stripe Subscription object); omit it (e.g. `checkout.session.completed`, which has no Subscription object to read a status from) to leave whatever was already stored untouched. */
  providerStatus?: string;
  trialStartedAt?: string;
  trialEndsAt?: string;
  /** See `Subscription.trialUsedAt`'s own comment. COALESCE-preserve like every other field here — pass this only once, from `createCheckoutSessionForPlan`, the first time a trial is actually granted; omit it on every other call so it is never cleared. */
  trialUsedAt?: string;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  billingCustomerId?: string;
  providerSubscriptionId?: string;
  providerCheckoutSessionId?: string;
  canceledAt?: string;
  /**
   * True clears `canceled_at` back to NULL instead of the default
   * COALESCE-preserve — pass this (from `applyStripeSubscription`, which
   * always knows Stripe's current truth for this field whenever the
   * incoming payload actually includes `canceled_at`) when Stripe reports
   * NO cancellation timestamp for an event that isn't itself a
   * `.deleted`/forced-canceled one. Without this, a subscription that was
   * scheduled to cancel and then reactivated (Stripe clears its own
   * `canceled_at` on reactivation) would keep showing the stale original
   * cancellation timestamp forever — `status`/`cancel_at_period_end`
   * would correctly reflect the reactivation, but `canceled_at` alone
   * would not, since plain `COALESCE(NULL, canceled_at)` can never
   * express "clear this," only "leave it." (2026-09 incident audit.)
   */
  clearCanceledAt?: boolean;
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
         trial_used_at = COALESCE($4, trial_used_at),
         trial_ends_at = COALESCE($5, trial_ends_at),
         current_period_start = COALESCE($6, current_period_start),
         current_period_end = COALESCE($7, current_period_end),
         billing_customer_id = COALESCE($8, billing_customer_id),
         provider_subscription_id = COALESCE($9, provider_subscription_id),
         provider_checkout_session_id = COALESCE($10, provider_checkout_session_id),
         canceled_at = CASE WHEN $18 THEN NULL ELSE COALESCE($11, canceled_at) END,
         cancel_at_period_end = COALESCE($12, cancel_at_period_end),
         cancel_at = CASE WHEN $12 = FALSE THEN NULL ELSE COALESCE($13, cancel_at) END,
         last_webhook_event_id = COALESCE($14, last_webhook_event_id),
         last_webhook_event_created_at = COALESCE($15, last_webhook_event_created_at),
         updated_at = $16,
         provider_status = COALESCE($19, provider_status)
       WHERE business_id = $17`,
      [
        input.planId,
        input.status,
        input.trialStartedAt ?? null,
        input.trialUsedAt ?? null,
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
        input.clearCanceledAt ?? false,
        input.providerStatus ?? null,
      ],
    );
  } else {
    await db.query(
      `INSERT INTO subscriptions (
         id, business_id, plan_id, status, trial_started_at, trial_used_at, trial_ends_at,
         current_period_start, current_period_end, billing_customer_id,
         provider_subscription_id, provider_checkout_session_id, canceled_at,
         cancel_at_period_end, cancel_at,
         last_webhook_event_id, last_webhook_event_created_at, created_at, updated_at, provider_status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
      [
        makeId("subscription"),
        businessId,
        input.planId,
        input.status,
        input.trialStartedAt ?? null,
        input.trialUsedAt ?? null,
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
        input.providerStatus ?? null,
      ],
    );
  }

  const saved = await getSubscriptionByBusinessId(db, businessId);
  if (!saved) throw new Error("Failed to read back the subscription that was just saved.");
  return saved;
}

/**
 * The ONE narrow write the provider-status reconciliation CLI
 * (`db/reconcileProviderStatus.ts`, via `services/providerStatusReconciliation.ts`)
 * is allowed to use — updates `provider_status` alone. Deliberately a
 * dedicated single-column `UPDATE`, not a call into `upsertSubscription`
 * (whose `status`/`planId` parameters are mandatory and always
 * unconditionally written, never COALESCE-preserved) — this makes it
 * structurally impossible for that reconciliation path to ever alter
 * entitlement `status`, `plan_id`, or anything else on this row. See
 * docs/decisions/0037-provider-status-reconciliation.md.
 */
export async function setProviderStatus(db: Queryable, businessId: string, providerStatus: string): Promise<void> {
  await db.query(`UPDATE subscriptions SET provider_status = $1 WHERE business_id = $2`, [providerStatus, businessId]);
}

/**
 * Every subscription row, joined with its business's name — the one admin
 * dashboard query this table needs (see
 * docs/decisions/0035-admin-dashboard.md). Deliberately NOT scoped by
 * `businessId` — the one legitimate cross-tenant read in this file,
 * reachable only from `services/admin.ts`, which independently verifies
 * the caller is an admin before ever calling this. `subscriptions` has at
 * most one row per business (`UNIQUE(business_id)`), so this is bounded by
 * total business count, not by quotes or customers — the tables that
 * actually need paginated, indexed queries as the platform grows (see
 * `repositories/admin.ts`).
 */
export async function listAllSubscriptionsWithBusinessName(
  db: Queryable,
): Promise<(Subscription & { businessName: string })[]> {
  const result = await db.query<SubscriptionRow & { business_name: string }>(
    `SELECT s.*, b.name AS business_name FROM subscriptions s JOIN businesses b ON b.id = s.business_id`,
  );
  return result.rows.map((row) => ({ ...toSubscription(row), businessName: row.business_name }));
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
