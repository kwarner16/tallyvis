"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { buttonVariants } from "@tallyvis/ui";
import { chooseSelfInstallAction } from "@/lib/subscriptionActions";

/**
 * Phase 14 Stripe V1 hardening (see docs/decisions/0018) introduced a paid
 * "professional installation" choice alongside free self-install. That paid
 * choice has since been removed from this UI (see
 * docs/decisions/0028-mobile-sms-embed-and-growth-updates.md) — for now,
 * Kyle is personally helping early customers install and verify Tallyvis as
 * part of onboarding, so there's no setup fee to present. The underlying
 * Stripe checkout path for a paid installation
 * (`createInstallationCheckoutSessionAction`/`PROFESSIONAL_INSTALLATION_FEE`)
 * still exists server-side, unreferenced, in case the fee is reinstated
 * later — nothing here calls it. Shown only when no installation charge is
 * on file yet (see `/dashboard/billing`, which reads `listBillingCharges`).
 */
export function InstallationChoice() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGetStarted() {
    setPending(true);
    setError(null);
    const result = await chooseSelfInstallAction();
    if (result.ok) {
      router.refresh();
    } else {
      setError(result.message);
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      <div>
        <button
          type="button"
          onClick={handleGetStarted}
          disabled={pending}
          className={buttonVariants({ variant: "primary" })}
        >
          {pending ? "Saving…" : "Get started — no charge"}
        </button>
      </div>
      <p className="text-xs text-ink-faint">
        No installation fee right now — Kyle will personally help you get the estimator live on your
        website. Head to the Website page for the install snippet, or reach out and he&rsquo;ll walk
        through it with you.
      </p>
    </div>
  );
}
