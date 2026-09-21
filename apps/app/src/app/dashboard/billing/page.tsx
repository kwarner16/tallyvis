import Link from "next/link";
import { getPlan, TRIAL_DAYS } from "@tallyvis/config";
import { billingConfigured, getSubscription, listBillingCharges, resolveEffectiveStatus } from "@tallyvis/api";
import { buttonVariants } from "@tallyvis/ui";
import { requireContext } from "@/lib/session";

const STATUS_LABELS: Record<string, string> = {
  trialing: "Trialing",
  active: "Active",
  canceled: "Canceled",
  expired: "Expired",
  incomplete: "Incomplete",
};

const CHARGE_STATUS_LABELS: Record<string, string> = { pending: "Pending", paid: "Paid", waived: "Waived" };

/** Kept outside the component body — this Server Component intentionally reads "now" fresh on every request (it's never memoized/re-rendered client-side), but a plain helper function keeps the impure `Date.now()` call out of the component/render body itself. */
function daysRemainingUntil(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}

/**
 * Phase 14 — subscription/trial status + the one-time installation fee,
 * modeled and displayed as a SEPARATE concept from the recurring plan.
 * See docs/decisions/0016-onboarding-billing-embed.md.
 */
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const { db, session } = await requireContext();
  const { checkout } = await searchParams;
  const subscription = getSubscription(db, session);
  const charges = listBillingCharges(db, session);

  if (!subscription) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Billing</h1>
        <div className="rounded-2xl border border-line bg-paper p-6">
          <p className="text-sm text-ink-soft">You haven&rsquo;t chosen a plan yet.</p>
          <Link href="/dashboard/onboarding" className={buttonVariants({ variant: "primary", className: "mt-4" })}>
            Choose a plan
          </Link>
        </div>
      </div>
    );
  }

  const plan = getPlan(subscription.planId);
  const effectiveStatus = resolveEffectiveStatus(subscription);
  const trialDaysRemaining =
    effectiveStatus === "trialing" && subscription.trialEndsAt ? daysRemainingUntil(subscription.trialEndsAt) : null;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Billing</h1>

      {checkout === "success" ? (
        <p className="rounded-lg border border-accent bg-accent-soft px-4 py-2.5 text-sm text-accent-strong">
          Checkout complete — your subscription will update automatically once confirmed.
        </p>
      ) : null}
      {checkout === "canceled" ? (
        <p className="rounded-lg border border-line bg-paper-alt px-4 py-2.5 text-sm text-ink-soft">
          Checkout was canceled — no changes were made.
        </p>
      ) : null}

      <div className="rounded-2xl border border-line bg-paper p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Current plan</p>
            <p className="mt-1 text-lg font-semibold text-ink">{plan?.name ?? subscription.planId}</p>
          </div>
          <span className="rounded-full bg-paper-alt px-3 py-1 text-xs font-medium text-ink-soft">
            {STATUS_LABELS[effectiveStatus] ?? effectiveStatus}
          </span>
        </div>
        {trialDaysRemaining !== null ? (
          <p className="mt-3 text-sm text-ink-soft">
            {trialDaysRemaining > 0
              ? `${trialDaysRemaining} of ${TRIAL_DAYS} trial days remaining.`
              : "Your trial ends today."}
          </p>
        ) : null}
        {effectiveStatus === "expired" ? (
          <p className="mt-3 text-sm text-ink-soft">
            Your trial has ended. Reactivate to keep creating quotes from the dashboard.
          </p>
        ) : null}
        <Link href="/dashboard/onboarding" className={buttonVariants({ variant: "outline", className: "mt-4" })}>
          {effectiveStatus === "active" ? "Change plan" : "Reactivate / change plan"}
        </Link>
        {!billingConfigured() ? (
          <p className="mt-3 text-xs text-ink-faint">
            Billing isn&rsquo;t configured in this environment — trial state is fully functional; paid
            checkout requires Stripe credentials to be configured.
          </p>
        ) : null}
      </div>

      <div className="rounded-2xl border border-line bg-paper p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">One-time charges</p>
        {charges.length === 0 ? (
          <p className="mt-2 text-sm text-ink-faint">None yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {charges.map((charge) => (
              <li key={charge.id} className="flex items-center justify-between text-sm">
                <span className="text-ink-soft">
                  {charge.kind === "website_installation" ? "Website installation & setup" : charge.kind}
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-mono text-ink">${(charge.amountCents / 100).toFixed(2)}</span>
                  <span className="rounded-full bg-paper-alt px-2 py-0.5 text-xs text-ink-faint">
                    {CHARGE_STATUS_LABELS[charge.status] ?? charge.status}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-ink-faint">
          Separate from your recurring plan — a one-time fee for getting the estimator installed on
          your website.
        </p>
      </div>
    </div>
  );
}
