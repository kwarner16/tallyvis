"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PLANS, TRIAL_DAYS, type PlanId } from "@tallyvis/config";
import { buttonVariants, cn } from "@tallyvis/ui";
import { startTrialAction, createCheckoutSessionAction } from "@/lib/subscriptionActions";

/**
 * Phase 14 — plan selection (see
 * docs/decisions/0016-onboarding-billing-embed.md). Plans come from
 * `@tallyvis/config`'s `PLANS` — the single authoritative definition also
 * used by apps/web's marketing pricing section, never duplicated here.
 * "Start free trial" needs no payment method and always works; "Subscribe
 * now" only appears when billing is actually configured, and is honest
 * about that rather than showing a button that would fail.
 */
export function PlanSelector({
  initialPlanId,
  billingIsConfigured,
}: {
  initialPlanId?: PlanId;
  billingIsConfigured: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<PlanId>(initialPlanId ?? "growth");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStartTrial() {
    setStarting(true);
    setError(null);
    try {
      await startTrialAction(selected);
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start your trial.");
      setStarting(false);
    }
  }

  async function handleSubscribeNow() {
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

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleStartTrial}
          disabled={starting}
          className={buttonVariants({ variant: "primary" })}
        >
          {starting ? "Starting…" : `Start ${TRIAL_DAYS}-day free trial`}
        </button>
        {billingIsConfigured ? (
          <button
            type="button"
            onClick={handleSubscribeNow}
            disabled={starting}
            className={buttonVariants({ variant: "outline" })}
          >
            Subscribe now instead
          </button>
        ) : null}
        <p className="text-xs text-ink-faint">No credit card required to start your trial.</p>
      </div>
      {!billingIsConfigured ? (
        <p className="text-xs text-ink-faint">
          Billing isn&rsquo;t configured in this environment yet — trials work fully; paid checkout will
          be available once billing credentials are configured.
        </p>
      ) : null}
    </div>
  );
}
