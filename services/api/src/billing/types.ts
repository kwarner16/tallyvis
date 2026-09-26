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
  /**
   * A Stripe idempotency key scoped to one logical checkout attempt (see
   * `subscriptions.ts`'s key-derivation comment) — required, not optional,
   * so no Checkout Session creation call can ever be made without one.
   * Retrying the identical attempt (a double-click, two tabs, a network
   * retry) with the same key returns Stripe's original result instead of
   * creating a second object; a genuinely later attempt naturally derives
   * a different key once the underlying state has moved on, and Stripe
   * itself expires unused keys after 24 hours regardless.
   */
  idempotencyKey: string;
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

/**
 * The shape of a Stripe subscription object — identical whether it arrives
 * as a webhook event's `data.object` (see `services/billingWebhooks.ts`) or
 * from a direct `GET /v1/subscriptions/{id}` reconciliation fetch (see
 * `services/subscriptions.ts`'s `reconcileSubscriptionFromStripe`) — one
 * shape, one field-mapping function (`buildSubscriptionPatchFromStripe`),
 * used by both callers.
 */
export interface StripeSubscriptionObject {
  id: string;
  status: string;
  /** Stripe Customer id — used only for the metadata-fallback backfill in `applyStripeSubscription` (see that function's own comment); every other field mapping goes through `buildSubscriptionPatchFromStripe`. */
  customer?: string;
  current_period_start?: number;
  current_period_end?: number;
  canceled_at?: number | null;
  trial_start?: number | null;
  trial_end?: number | null;
  cancel_at_period_end?: boolean;
  cancel_at?: number | null;
  items?: { data?: Array<{ price?: { id?: string } }> };
  metadata?: { businessId?: string };
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
  /**
   * Cancels a subscription IMMEDIATELY (never merely "at period end") — the
   * account-deletion semantics: once local data is about to be deleted,
   * there is no "keep billing until the end of the period" option, since
   * there will be no Tallyvis account left to grant access to. Never
   * deletes the underlying Stripe Customer — see `services/accountDeletion.ts`
   * for why financial/accounting records intentionally remain in Stripe.
   */
  cancelSubscriptionImmediately(providerSubscriptionId: string): Promise<void>;
  /**
   * Fetches the real, current Stripe subscription object directly (not via
   * a webhook event) — used ONLY for the targeted, narrowly-scoped
   * reconciliation path in `services/subscriptions.ts`'s
   * `reconcileSubscriptionFromStripe` (a local row genuinely stuck at
   * `incomplete` despite already having a real `provider_subscription_id`
   * — i.e. a missed/delayed webhook), never on every request or as a
   * general-purpose "refresh from Stripe" — see that function's own
   * comment for why this is deliberately bounded.
   */
  retrieveSubscription(providerSubscriptionId: string): Promise<StripeSubscriptionObject>;
}
