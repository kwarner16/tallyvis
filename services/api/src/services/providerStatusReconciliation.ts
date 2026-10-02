import type { Queryable } from "../db/pg/client";
import { retrieveSubscription } from "../billing";
import { listAllSubscriptionsWithBusinessName, setProviderStatus } from "../repositories/subscriptions";

/**
 * The computation + (optionally) the write behind the founder-run
 * `pnpm --filter @tallyvis/api reconcile-provider-status` CLI (see
 * docs/decisions/0037-provider-status-reconciliation.md). Separated from
 * `db/reconcileProviderStatus.ts`'s thin CLI wrapper so this is directly
 * unit-testable against a real database with Stripe mocked out — the
 * same split `services/billingWebhooks.ts`'s `buildSubscriptionPatchFromStripe`
 * (pure computation) already uses relative to `handleStripeWebhook` (the
 * I/O wrapper).
 *
 * Deliberately narrow: for every subscription with a real Stripe
 * subscription id on file, fetches ONLY Stripe's current raw `status` and
 * writes it ONLY to `provider_status` (via `setProviderStatus`, which
 * physically cannot touch any other column). Never calls
 * `upsertSubscription`, never resolves a plan from a Price id, never
 * reads/writes trial or cancellation dates, never calls any
 * Stripe-mutating endpoint — this only ever reads Stripe's subscription
 * object and writes one column. `subscriptions.status` (TallyVis's own
 * entitlement signal) and every other column are completely untouched,
 * regardless of what Stripe reports.
 *
 * A Stripe failure for one subscription is caught and recorded in
 * `failures`, never thrown — every other row is still processed. A row
 * whose `provider_status` already matches Stripe's current value is
 * counted in `unchangedCount` and neither re-written (in apply mode) nor
 * listed in `changes` — safe to run repeatedly, and a repeat run only
 * reports/writes genuine changes.
 */

export interface ProviderStatusChange {
  businessId: string;
  businessName: string;
  providerSubscriptionId: string;
  /** `undefined` renders as "NULL" in the CLI's dry-run output — never fabricated, exactly what was stored before this run. */
  previousProviderStatus: string | undefined;
  newProviderStatus: string;
}

export interface ProviderStatusReconciliationFailure {
  businessId: string;
  businessName: string;
  providerSubscriptionId: string;
  /** Always `Error#message` (or `String(err)`), never the raw error object — consistent with every other console-facing error message in this codebase, and never includes request/response bodies that could carry sensitive billing details. */
  error: string;
}

export interface ProviderStatusReconciliationResult {
  totalSubscriptions: number;
  /** Subscriptions with no `providerSubscriptionId` on file at all — e.g. a `startTrial`-only DB-only subscription with no real Stripe object yet. Never contacted, never reported as a failure. */
  skippedNoProviderSubscriptionId: number;
  changes: ProviderStatusChange[];
  unchangedCount: number;
  failures: ProviderStatusReconciliationFailure[];
}

export interface ReconcileProviderStatusesOptions {
  /** `false` (the default via the CLI) computes and reports `changes` without writing anything. `true` additionally calls `setProviderStatus` for each change. */
  apply: boolean;
}

export async function reconcileProviderStatuses(
  db: Queryable,
  options: ReconcileProviderStatusesOptions,
): Promise<ProviderStatusReconciliationResult> {
  const subscriptions = await listAllSubscriptionsWithBusinessName(db);
  const withProviderId = subscriptions.filter(
    (subscription): subscription is typeof subscription & { providerSubscriptionId: string } =>
      Boolean(subscription.providerSubscriptionId),
  );

  const changes: ProviderStatusChange[] = [];
  const failures: ProviderStatusReconciliationFailure[] = [];
  let unchangedCount = 0;

  for (const subscription of withProviderId) {
    let newProviderStatus: string;
    try {
      const stripeSub = await retrieveSubscription(subscription.providerSubscriptionId);
      newProviderStatus = stripeSub.status;
    } catch (err) {
      failures.push({
        businessId: subscription.businessId,
        businessName: subscription.businessName,
        providerSubscriptionId: subscription.providerSubscriptionId,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    if (newProviderStatus === subscription.providerStatus) {
      unchangedCount++;
      continue;
    }

    changes.push({
      businessId: subscription.businessId,
      businessName: subscription.businessName,
      providerSubscriptionId: subscription.providerSubscriptionId,
      previousProviderStatus: subscription.providerStatus,
      newProviderStatus,
    });

    if (options.apply) {
      await setProviderStatus(db, subscription.businessId, newProviderStatus);
    }
  }

  return {
    totalSubscriptions: subscriptions.length,
    skippedNoProviderSubscriptionId: subscriptions.length - withProviderId.length,
    changes,
    unchangedCount,
    failures,
  };
}
