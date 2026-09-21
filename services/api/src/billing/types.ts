/**
 * Phase 14 — the billing provider abstraction (see
 * docs/decisions/0016-onboarding-billing-embed.md, extended in
 * docs/decisions/0018-stripe-v1-hardening.md). Mirrors the same "narrow
 * interface + categorized error + one env-driven resolver" pattern
 * `services/ai`'s `AiProvider` and `services/api/notifications`'s
 * `EmailProvider` already established. Stripe is the only implementation
 * (see `providers/stripe.ts`) — modeled using Stripe's own concepts
 * (customers, checkout sessions, subscriptions, the billing portal) rather
 * than an invented abstraction, per this phase's brief.
 */

export interface CreateCheckoutSessionInput {
  /** "subscription" for a recurring plan (with a trial); "payment" for the one-time professional installation fee. Never mixed in the same session. */
  mode: "subscription" | "payment";
  /** The persistent Stripe Price id to charge — always server-resolved from `@tallyvis/config` (via each plan's/fee's `stripePriceEnvVar`), never a client-suppliable amount. */
  priceId: string;
  /** Reuse an existing Stripe Customer when this business already has one on file (see subscriptions.ts's customer-reuse comment) — mutually exclusive with `customerEmail` on Stripe's own API. */
  customerId?: string;
  /** Only used when there's no `customerId` yet (this business's first checkout). */
  customerEmail?: string;
  /** Only meaningful for `mode: "subscription"`. */
  trialDays?: number;
  successUrl: string;
  cancelUrl: string;
  /** Round-tripped back on the webhook event so the handler can resolve which business/subscription/charge this session belongs to without trusting anything else client-supplied. */
  metadata: Record<string, string>;
}

export interface CheckoutSessionResult {
  id: string;
  url: string;
}

export interface CreatePortalSessionInput {
  customerId: string;
  returnUrl: string;
}

export interface PortalSessionResult {
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
  createPortalSession(input: CreatePortalSessionInput): Promise<PortalSessionResult>;
}
