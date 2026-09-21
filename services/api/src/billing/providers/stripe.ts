import {
  BillingProviderError,
  type BillingProvider,
  type CreateCheckoutSessionInput,
  type CheckoutSessionResult,
  type CreatePortalSessionInput,
  type PortalSessionResult,
} from "../types";

/**
 * Stripe, via Stripe's REST API directly (plain `fetch`, no SDK
 * dependency — the same choice this repo already made for
 * `services/api/notifications/providers/resend.ts`). Only reached when
 * `STRIPE_SECRET_KEY` is set; the key is read exclusively where this
 * provider is constructed (`billing/index.ts`), never bundled to a
 * browser, never logged.
 *
 * Uses persistent Stripe Products/Prices (created once in the Stripe
 * Dashboard/API — see docs/decisions/0018-stripe-v1-hardening.md), not
 * inline `price_data`: this is required for the Stripe Customer Portal's
 * plan-switching feature, which can only offer a fixed, pre-configured set
 * of Price ids. `@tallyvis/config`'s `PLANS` remains the one authoritative
 * place a plan's price is DEFINED; the Price id is just where that
 * definition is billed from — see `billing/index.ts` for the
 * planId/env-var -> Stripe Price id resolution.
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

async function postForm(
  baseUrl: string,
  secretKey: string,
  path: string,
  body: Record<string, string>,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
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

  return (await response.json()) as Record<string, unknown>;
}

export function createStripeProvider(config: StripeProviderConfig): BillingProvider {
  const baseUrl = config.baseUrl ?? "https://api.stripe.com";

  async function createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSessionResult> {
    const body: Record<string, string> = {
      mode: input.mode,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      "line_items[0][quantity]": "1",
      "line_items[0][price]": input.priceId,
    };

    // Stripe's Checkout Sessions API rejects passing both `customer` and
    // `customer_email` — reuse the existing Stripe Customer when this
    // business already has one on file (see subscriptions.ts), otherwise
    // let Checkout create a new Customer from the email.
    if (input.customerId) {
      body.customer = input.customerId;
    } else if (input.customerEmail) {
      body.customer_email = input.customerEmail;
    }

    if (input.mode === "subscription" && input.trialDays) {
      body["subscription_data[trial_period_days]"] = String(input.trialDays);
      for (const [key, value] of Object.entries(input.metadata)) {
        body[`subscription_data[metadata][${key}]`] = value;
      }
    }
    for (const [key, value] of Object.entries(input.metadata)) {
      body[`metadata[${key}]`] = value;
    }

    const session = (await postForm(baseUrl, config.secretKey, "/v1/checkout/sessions", body)) as {
      id: string;
      url: string | null;
    };
    if (!session.url) {
      throw new BillingProviderError("The billing provider did not return a checkout URL.", "provider-error");
    }
    return { id: session.id, url: session.url };
  }

  async function createPortalSession(input: CreatePortalSessionInput): Promise<PortalSessionResult> {
    const session = (await postForm(baseUrl, config.secretKey, "/v1/billing_portal/sessions", {
      customer: input.customerId,
      return_url: input.returnUrl,
    })) as { url: string | null };
    if (!session.url) {
      throw new BillingProviderError("The billing provider did not return a billing portal URL.", "provider-error");
    }
    return { url: session.url };
  }

  return { name: "stripe", createCheckoutSession, createPortalSession };
}
