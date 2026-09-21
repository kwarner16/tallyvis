import { PLANS, PROFESSIONAL_INSTALLATION_FEE, type PlanId } from "@tallyvis/config";
import { createStripeProvider } from "./providers/stripe";
import {
  BillingProviderError,
  type BillingProvider,
  type CreateCheckoutSessionInput,
  type CheckoutSessionResult,
  type CreatePortalSessionInput,
  type PortalSessionResult,
} from "./types";

export {
  BillingProviderError,
  type BillingProvider,
  type BillingErrorCategory,
  type CreateCheckoutSessionInput,
  type CheckoutSessionResult,
  type CreatePortalSessionInput,
  type PortalSessionResult,
} from "./types";

/**
 * This file is the only place `STRIPE_SECRET_KEY` and every
 * `STRIPE_PRICE_*` env var are read — every caller only ever calls
 * `createCheckoutSession()`/`createPortalSession()` below, never a provider
 * directly, and only ever resolves a Price id through
 * `resolveStripePriceId()`/`resolvePlanIdFromPriceId()`. See
 * docs/decisions/0016-onboarding-billing-embed.md and
 * docs/decisions/0018-stripe-v1-hardening.md.
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

export async function createPortalSession(input: CreatePortalSessionInput): Promise<PortalSessionResult> {
  const provider = resolveBillingProvider();
  return provider.createPortalSession(input);
}

/** Surfaced to the dashboard so it can show "Billing not configured" honestly rather than a button that would fail when clicked. */
export function isBillingConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function isWebhookConfigured(): boolean {
  return Boolean(process.env.STRIPE_WEBHOOK_SECRET);
}

/**
 * Resolves a plan's real Stripe recurring Price id for the CURRENT
 * environment (test-mode locally/in CI, live-mode in production) — the id
 * itself lives only in env vars (`STRIPE_PRICE_STARTER`/`_GROWTH`/`_PRO`),
 * never committed, so a test-mode deployment can never accidentally
 * reference a live-mode price or vice versa. Throws the same categorized
 * `BillingProviderError` as an unconfigured secret key: an unpriced plan is
 * exactly as unusable as a provider with no credentials.
 */
export function resolveStripePriceId(planId: PlanId): string {
  const plan = PLANS.find((p) => p.id === planId);
  if (!plan) throw new Error(`Unknown plan "${planId}".`);
  const priceId = process.env[plan.stripePriceEnvVar];
  if (!priceId) {
    console.error(`Billing provider not configured: ${plan.stripePriceEnvVar} is unset.`);
    throw new BillingProviderError(
      "Billing isn't configured yet. Please contact the Tallyvis team.",
      "not-configured",
    );
  }
  return priceId;
}

/** Same resolution as `resolveStripePriceId`, for the one-time professional installation fee rather than a recurring plan. */
export function resolveInstallationPriceId(): string {
  const priceId = process.env[PROFESSIONAL_INSTALLATION_FEE.stripePriceEnvVar];
  if (!priceId) {
    console.error(`Billing provider not configured: ${PROFESSIONAL_INSTALLATION_FEE.stripePriceEnvVar} is unset.`);
    throw new BillingProviderError(
      "Billing isn't configured yet. Please contact the Tallyvis team.",
      "not-configured",
    );
  }
  return priceId;
}

/**
 * The reverse lookup: given a Stripe Price id from a webhook payload (e.g.
 * a Customer Portal plan switch), find which of our own `PlanId`s it
 * corresponds to — so `subscriptions.plan_id` stays in sync after a
 * portal-driven upgrade/downgrade, not just after a Tallyvis-initiated
 * Checkout. Returns `undefined` for a price this environment's config
 * doesn't recognize (e.g. stale/foreign data) — callers must leave the
 * existing planId untouched rather than corrupt it in that case.
 */
export function resolvePlanIdFromPriceId(priceId: string): PlanId | undefined {
  return PLANS.find((plan) => process.env[plan.stripePriceEnvVar] === priceId)?.id;
}
