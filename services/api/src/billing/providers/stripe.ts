import { BillingProviderError, type BillingProvider, type CreateCheckoutSessionInput, type CheckoutSessionResult } from "../types";

/**
 * Stripe, via Stripe's REST API directly (plain `fetch`, no SDK
 * dependency — the same choice this repo already made for
 * `services/api/notifications/providers/resend.ts`). Only reached when
 * `STRIPE_SECRET_KEY` is set; the key is read exclusively where this
 * provider is constructed (`billing/index.ts`), never bundled to a
 * browser, never logged.
 *
 * No Stripe credentials exist in this development environment, so this
 * path has NOT been exercised against Stripe's real API — only the
 * request shape has been written against Stripe's published Checkout
 * Sessions contract (https://stripe.com/docs/api/checkout/sessions/create).
 * Do not treat a passing test suite as proof this works against the real
 * API; see docs/decisions/0016-onboarding-billing-embed.md for exactly
 * what is and isn't verified.
 *
 * Pricing is defined ONCE, in `@tallyvis/config`'s `PLANS` — this provider
 * uses Stripe's `price_data` (an inline, ad-hoc price) rather than
 * requiring a Product/Price to be pre-created in the Stripe dashboard, so
 * there is no second copy of a plan's price to keep in sync.
 */

export interface StripeProviderConfig {
  secretKey: string;
  baseUrl?: string;
}

interface StripeErrorResponse {
  error?: { message?: string; type?: string };
}

function encodeFormBody(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

export function createStripeProvider(config: StripeProviderConfig): BillingProvider {
  const baseUrl = config.baseUrl ?? "https://api.stripe.com";

  async function createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSessionResult> {
    const body: Record<string, string> = {
      mode: "subscription",
      customer_email: input.customerEmail,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(input.monthlyPriceCents),
      "line_items[0][price_data][recurring][interval]": "month",
      "line_items[0][price_data][product_data][name]": `Tallyvis — ${input.planName} plan`,
      "subscription_data[trial_period_days]": String(input.trialDays),
    };
    for (const [key, value] of Object.entries(input.metadata)) {
      body[`metadata[${key}]`] = value;
      body[`subscription_data[metadata][${key}]`] = value;
    }

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/v1/checkout/sessions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.secretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: encodeFormBody(body),
      });
    } catch {
      throw new BillingProviderError("Could not reach the billing provider.", "provider-error");
    }

    if (!response.ok) {
      const parsed = (await response.json().catch(() => ({}))) as StripeErrorResponse;
      if (response.status === 401 || response.status === 403) {
        throw new BillingProviderError("The billing provider rejected the configured credentials.", "provider-error");
      }
      throw new BillingProviderError(
        parsed.error?.message ?? `The billing provider returned an error (status ${response.status}).`,
        "invalid-request",
      );
    }

    const session = (await response.json()) as { id: string; url: string | null };
    if (!session.url) {
      throw new BillingProviderError("The billing provider did not return a checkout URL.", "provider-error");
    }
    return { id: session.id, url: session.url };
  }

  return { name: "stripe", createCheckoutSession };
}
