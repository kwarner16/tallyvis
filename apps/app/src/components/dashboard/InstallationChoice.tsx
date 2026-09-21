"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PROFESSIONAL_INSTALLATION_FEE } from "@tallyvis/config";
import { buttonVariants } from "@tallyvis/ui";
import { createInstallationCheckoutSessionAction, chooseSelfInstallAction } from "@/lib/subscriptionActions";

/**
 * Phase 14 Stripe V1 hardening (see docs/decisions/0018): the one-time
 * professional installation fee is optional and entirely separate from
 * the recurring plan — a business either pays $299 for Tallyvis to install
 * the estimator, or installs it themselves for free. Shown only when
 * neither choice has been made yet (see `/dashboard/billing`, which reads
 * `listBillingCharges` and only renders this when there's no
 * "website_installation" charge on file).
 */
export function InstallationChoice() {
  const router = useRouter();
  const [pending, setPending] = useState<"professional" | "self" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleProfessional() {
    setPending("professional");
    setError(null);
    try {
      const { url } = await createInstallationCheckoutSessionAction();
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start installation checkout.");
      setPending(null);
    }
  }

  async function handleSelfInstall() {
    setPending("self");
    setError(null);
    try {
      await chooseSelfInstallAction();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record your installation choice.");
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleProfessional}
          disabled={pending !== null}
          className={buttonVariants({ variant: "primary" })}
        >
          {pending === "professional"
            ? "Starting checkout…"
            : `Professional installation — $${(PROFESSIONAL_INSTALLATION_FEE.amountCents / 100).toFixed(0)}`}
        </button>
        <button
          type="button"
          onClick={handleSelfInstall}
          disabled={pending !== null}
          className={buttonVariants({ variant: "outline" })}
        >
          {pending === "self" ? "Saving…" : "Self-install — Free"}
        </button>
      </div>
      <p className="text-xs text-ink-faint">
        Optional, one-time, and separate from your recurring plan. Choose professional installation and
        the Tallyvis team gets the estimator live on your website; choose self-install and follow the
        embed instructions yourself at no cost.
      </p>
    </div>
  );
}
