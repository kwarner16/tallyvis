/**
 * Phase 14 — the billing provider abstraction (see
 * docs/decisions/0016-onboarding-billing-embed.md). Mirrors the same
 * "narrow interface + categorized error + one env-driven resolver"
 * pattern `services/ai`'s `AiProvider` and `services/api/notifications`'s
 * `EmailProvider` already established. Stripe is the only implementation
 * (see `providers/stripe.ts`) — modeled using Stripe's own concepts
 * (customers, checkout sessions, subscriptions) rather than an invented
 * abstraction, per this phase's brief.
 */

export interface CreateCheckoutSessionInput {
  customerEmail: string;
  planId: string;
  planName: string;
  monthlyPriceCents: number;
  trialDays: number;
  successUrl: string;
  cancelUrl: string;
  /** Round-tripped back on the webhook event so the handler can resolve which business/subscription this session belongs to without trusting anything else client-supplied. */
  metadata: Record<string, string>;
}

export interface CheckoutSessionResult {
  id: string;
  url: string;
}

export type BillingErrorCategory = "not-configured" | "provider-error" | "invalid-request";

export class BillingProviderError extends Error {
  readonly category: BillingErrorCategory;

  constructor(message: string, category: BillingErrorCategory) {
    super(message);
    this.name = "BillingProviderError";
    this.category = category;
  }
}

export interface BillingProvider {
  readonly name: string;
  createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSessionResult>;
}
