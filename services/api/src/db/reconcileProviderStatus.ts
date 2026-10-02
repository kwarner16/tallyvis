/**
 * Founder-run, explicit CLI reconciliation utility — populates
 * `subscriptions.provider_status` (Stripe's raw billing status) from
 * Stripe's own current state, for every subscription that has a real
 * Stripe subscription id on file. See
 * docs/decisions/0037-provider-status-reconciliation.md: migration
 * `0013_subscription_provider_status.sql` deliberately left every
 * existing row's `provider_status` `NULL` rather than fabricate a
 * historical value — this is the one explicit, founder-triggered way to
 * fill it in for whichever rows are still stuck `NULL` (or merely stale)
 * ahead of their next webhook.
 *
 * Same shape as `grantAdmin.ts`/`waiveInstallation.ts`: a one-off script
 * run directly against the database, never imported by anything else in
 * this app, and NEVER invoked automatically by a migration or at
 * application startup. Nothing calls this file except a human, on
 * purpose.
 *
 * Never alters `subscriptions.status` (TallyVis's own entitlement
 * signal), `plan_id`, trial/cancellation dates, or any Stripe
 * subscription itself — see `reconcileProviderStatuses`'s own comment
 * for the one, narrow write this performs. Safe to run repeatedly: a
 * subscription whose `provider_status` already matches Stripe's current
 * value is left untouched and reported as "already up to date."
 *
 * Usage:
 *   pnpm --filter @tallyvis/api reconcile-provider-status            # dry run — prints what would change, writes nothing
 *   pnpm --filter @tallyvis/api reconcile-provider-status --apply    # writes exactly the changes printed above
 */
import { isBillingConfigured } from "../billing";
import { getDb } from "./pg/client";
import { reconcileProviderStatuses } from "../services/providerStatusReconciliation";

async function main() {
  const apply = process.argv.includes("--apply");

  if (!isBillingConfigured()) {
    console.error("Billing provider not configured (STRIPE_SECRET_KEY unset) — nothing to reconcile against.");
    process.exit(1);
    return;
  }

  const db = getDb();
  const result = await reconcileProviderStatuses(db, { apply });

  for (const change of result.changes) {
    console.log(change.businessName);
    console.log(`  subscription: ${change.providerSubscriptionId}`);
    console.log(`  provider_status: ${change.previousProviderStatus ?? "NULL"} -> ${change.newProviderStatus}`);
    console.log("");
  }

  for (const failure of result.failures) {
    console.error(`FAILED  ${failure.businessName} (${failure.providerSubscriptionId}): ${failure.error}`);
  }

  console.log(
    apply
      ? "Applied — provider_status written for every change listed above."
      : "Dry run — no changes were written. Re-run with --apply to write these changes.",
  );
  console.log(`Subscriptions examined: ${result.totalSubscriptions}`);
  console.log(`Skipped (no Stripe subscription id on file): ${result.skippedNoProviderSubscriptionId}`);
  console.log(`${apply ? "Changed" : "Would change"}: ${result.changes.length}`);
  console.log(`Already up to date: ${result.unchangedCount}`);
  console.log(`Failed to reach Stripe: ${result.failures.length}`);

  if (result.failures.length > 0) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
