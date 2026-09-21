"use client";

import { useState } from "react";
import { buttonVariants } from "@tallyvis/ui";
import { createBillingPortalSessionAction } from "@/lib/subscriptionActions";

/**
 * Phase 14 Stripe V1 hardening (see docs/decisions/0018): redirects to the
 * Stripe-hosted Customer Portal — no custom card-management UI. Only
 * rendered by `/dashboard/billing` once a real Stripe Customer exists
 * (i.e. this business has been through Checkout at least once).
 */
export function ManageBillingButton() {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleManageBilling() {
    setStarting(true);
    setError(null);
    try {
      const { url } = await createBillingPortalSessionAction();
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open your billing portal.");
      setStarting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      <button type="button" onClick={handleManageBilling} disabled={starting} className={buttonVariants({ variant: "outline" })}>
        {starting ? "Opening…" : "Manage billing"}
      </button>
    </div>
  );
}
