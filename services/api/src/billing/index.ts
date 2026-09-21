import { createStripeProvider } from "./providers/stripe";
import { BillingProviderError, type BillingProvider, type CreateCheckoutSessionInput, type CheckoutSessionResult } from "./types";

export {
  BillingProviderError,
  type BillingProvider,
  type BillingErrorCategory,
  type CreateCheckoutSessionInput,
  type CheckoutSessionResult,
} from "./types";

/**
 * This file is the only place `STRIPE_SECRET_KEY` is read — every caller
 * only ever calls `createCheckoutSession()` below, never a provider
 * directly. See docs/decisions/0016-onboarding-billing-embed.md.
 */
function resolveBillingProvider(): BillingProvider {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    // The message here is what a business owner sees verbatim — kept
    // free of env var names/internal config details (those belong in
    // server logs, not the browser). See
    // docs/decisions/0017-billing-hardening.md.
    console.error("Billing provider not configured: STRIPE_SECRET_KEY is unset.");
    throw new BillingProviderError(
      "Billing isn't configured yet. Please contact the Tallyvis team.",
      "not-configured",
    );
  }
  return createStripeProvider({ secretKey });
}

export async function createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSessionResult> {
  const provider = resolveBillingProvider();
  return provider.createCheckoutSession(input);
}

/** Surfaced to the dashboard so it can show "Billing not configured" honestly rather than a button that would fail when clicked. */
export function isBillingConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function isWebhookConfigured(): boolean {
  return Boolean(process.env.STRIPE_WEBHOOK_SECRET);
}
