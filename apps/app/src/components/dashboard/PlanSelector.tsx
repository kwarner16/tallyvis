"use client";

import { useState } from "react";
import { PLANS, TRIAL_DAYS, type PlanId } from "@tallyvis/config";
import { buttonVariants, cn } from "@tallyvis/ui";
import { createCheckoutSessionAction } from "@/lib/subscriptionActions";

/**
 * Phase 14 (see docs/decisions/0016-onboarding-billing-embed.md), hardened
 * for V1 in docs/decisions/0018-stripe-v1-hardening.md. Plans come from
 * `@tallyvis/config`'s `PLANS` — the single authoritative definition also
 * used by apps/web's marketing pricing section, never duplicated here.
 *
 * There is now exactly ONE production path here: Stripe Checkout, card
 * required, Stripe-owned 7-day trial clock. The previous "start a trial
 * with no card" button has been retired from this UI (the underlying
 * DB-only `startTrial` still exists server-side for tests/internal use —
 * see `services/subscriptions.ts`'s own comment — but a real signup can no
 * longer reach it). When billing isn't configured in this environment at
 * all, the button is disabled with an honest explanation rather than
 * failing silently when clicked.
 */
export function PlanSelector({
  initialPlanId,
  billingIsConfigured,
}: {
  initialPlanId?: PlanId;
  billingIsConfigured: boolean;
}) {
  const [selected, setSelected] = useState<PlanId>(initialPlanId ?? "growth");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedPlan = PLANS.find((plan) => plan.id === selected);

  async function handleStartCheckout() {
    setStarting(true);
    setError(null);
    try {
      const { url } = await createCheckoutSessionAction(selected);
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout.");
      setStarting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-3">
        {PLANS.map((plan) => (
          <button
            key={plan.id}
            type="button"
            onClick={() => setSelected(plan.id)}
            className={cn(
              "flex flex-col gap-3 rounded-2xl border p-5 text-left transition-colors",
              selected === plan.id ? "border-accent-strong bg-accent-soft" : "border-line bg-paper hover:border-ink-faint",
            )}
          >
            {plan.featured ? (
              <span className="w-fit rounded-full bg-accent-strong px-2.5 py-0.5 text-xs font-semibold text-paper">
                Most popular
              </span>
            ) : null}
            <div>
              <p className="text-base font-semibold text-ink">{plan.name}</p>
              <p className="mt-1 flex items-baseline gap-1">
                <span className="text-2xl font-semibold tracking-tight text-ink">
                  ${(plan.monthlyPriceCents / 100).toFixed(0)}
                </span>
                <span className="text-xs text-ink-faint">/month</span>
              </p>
              <p className="mt-1 text-xs text-ink-soft">{plan.description}</p>
            </div>
            <ul className="flex flex-col gap-1 text-xs text-ink-soft">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-1.5">
                  <span aria-hidden="true" className="mt-1 h-1 w-1 shrink-0 rounded-sm bg-accent" />
                  {feature}
                </li>
              ))}
            </ul>
          </button>
        ))}
      </div>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {/* Makes the choice and its consequence explicit before the button is clicked — which plan, what it costs, how long the trial is, and that a card is required. */}
      <div className="rounded-xl border border-line bg-paper-alt px-4 py-3 text-sm text-ink-soft">
        <p>
          You&rsquo;re selecting <span className="font-medium text-ink">{selectedPlan?.name}</span> —
          <span className="font-medium text-ink"> ${((selectedPlan?.monthlyPriceCents ?? 0) / 100).toFixed(0)}/month</span> after
          your trial.
        </p>
        <p className="mt-1">
          Every plan includes a <span className="font-medium text-ink">{TRIAL_DAYS}-day free trial</span> —
          full dashboard access starting now. A card is required to start; billing begins automatically
          when the trial ends unless you cancel first.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleStartCheckout}
          disabled={starting || !billingIsConfigured}
          className={buttonVariants({ variant: "primary" })}
        >
          {starting ? "Starting checkout…" : `Start ${TRIAL_DAYS}-day free trial`}
        </button>
      </div>
      {!billingIsConfigured ? (
        <p className="text-xs text-ink-faint">
          Billing isn&rsquo;t configured in this environment yet — starting a trial requires Stripe
          credentials to be configured.
        </p>
      ) : null}
    </div>
  );
}
