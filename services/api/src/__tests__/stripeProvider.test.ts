import { createServer } from "node:http";
import type { RequestListener, Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createStripeProvider } from "../billing/providers/stripe";
import { BillingProviderError } from "../billing/types";

/**
 * The real Stripe provider adapter, verified against a local fake HTTP
 * server standing in for Stripe's API — not the live API (see
 * docs/decisions/0017-billing-hardening.md and
 * docs/decisions/0018-stripe-v1-hardening.md for exactly what this does
 * and does not prove). Mirrors the exact pattern
 * `services/ai/src/__tests__/anthropic.test.ts` already established for
 * the AI provider: a local server proves request construction and
 * response/error handling end-to-end without needing real network access
 * or a key.
 */

const sampleSubscriptionInput = () => ({
  mode: "subscription" as const,
  customerEmail: "owner@sparkle.example",
  priceId: "price_test_growth",
  trialDays: 7,
  successUrl: "https://app.tallyvis.example/dashboard/billing?checkout=success",
  cancelUrl: "https://app.tallyvis.example/dashboard/billing?checkout=canceled",
  metadata: { businessId: "business_abc123", planId: "growth" },
  idempotencyKey: "tallyvis:subscription-checkout:business_abc123:test",
});

const samplePaymentInput = () => ({
  mode: "payment" as const,
  customerEmail: "owner@sparkle.example",
  priceId: "price_test_installation",
  successUrl: "https://app.tallyvis.example/dashboard/billing?installation=success",
  cancelUrl: "https://app.tallyvis.example/dashboard/billing?installation=canceled",
  metadata: { businessId: "business_abc123", billingChargeId: "charge_abc123", kind: "website_installation" },
  idempotencyKey: "tallyvis:installation-checkout:business_abc123:test",
});

let server: Server | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

function listen(handler: RequestListener): Promise<string> {
  return new Promise((resolve) => {
    server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const address = server!.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

async function readFormBody(req: Parameters<RequestListener>[0]): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return new URLSearchParams(Buffer.concat(chunks).toString("utf-8"));
}

describe("createStripeProvider — subscription checkout (mode: subscription)", () => {
  it("sends the persistent Price id, trial length, and metadata — never a client-suppliable amount", async () => {
    let received: URLSearchParams | undefined;
    const baseUrl = await listen(async (req, res) => {
      received = await readFormBody(req);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ id: "cs_test_123", url: "https://checkout.stripe.example/cs_test_123" }));
    });

    const provider = createStripeProvider({ secretKey: "sk_test_fake", baseUrl });
    const result = await provider.createCheckoutSession(sampleSubscriptionInput());

    expect(result).toEqual({ id: "cs_test_123", url: "https://checkout.stripe.example/cs_test_123" });
    expect(received?.get("mode")).toBe("subscription");
    expect(received?.get("customer_email")).toBe("owner@sparkle.example");
    expect(received?.get("line_items[0][price]")).toBe("price_test_growth");
    expect(received?.get("subscription_data[trial_period_days]")).toBe("7");
    expect(received?.get("metadata[businessId]")).toBe("business_abc123");
    expect(received?.get("subscription_data[metadata][businessId]")).toBe("business_abc123");
    expect(received?.get("success_url")).toBe(sampleSubscriptionInput().successUrl);
    expect(received?.get("cancel_url")).toBe(sampleSubscriptionInput().cancelUrl);
    // No inline price_data anywhere — this is a persistent-Price integration.
    expect(received?.has("line_items[0][price_data][unit_amount]")).toBe(false);
  });

  it("explicitly disables Managed Payments (regression: some Stripe accounts enable it by default, which requires a product tax_code and otherwise rejects the session — discovered via a real test-mode Checkout Session creation, not by inspection)", async () => {
    let received: URLSearchParams | undefined;
    const baseUrl = await listen(async (req, res) => {
      received = await readFormBody(req);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ id: "cs_test_123", url: "https://checkout.stripe.example/cs_test_123" }));
    });

    const provider = createStripeProvider({ secretKey: "sk_test_fake", baseUrl });
    await provider.createCheckoutSession(sampleSubscriptionInput());

    expect(received?.get("managed_payments[enabled]")).toBe("false");
  });

  it("sends the caller-derived idempotency key as the Idempotency-Key header (never in the request body, and never invented by this layer itself)", async () => {
    let idempotencyKeyHeader: string | undefined;
    const baseUrl = await listen(async (req, res) => {
      idempotencyKeyHeader = req.headers["idempotency-key"] as string | undefined;
      await readFormBody(req);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ id: "cs_test_123", url: "https://checkout.stripe.example/cs_test_123" }));
    });

    const provider = createStripeProvider({ secretKey: "sk_test_fake", baseUrl });
    await provider.createCheckoutSession({
      ...sampleSubscriptionInput(),
      idempotencyKey: "tallyvis:subscription-checkout:business_abc123:2026-01-01T00:00:00.000Z",
    });

    expect(idempotencyKeyHeader).toBe("tallyvis:subscription-checkout:business_abc123:2026-01-01T00:00:00.000Z");
  });

  it("reuses an existing Stripe Customer (passes `customer`, not `customer_email`) when one is already on file", async () => {
    let received: URLSearchParams | undefined;
    const baseUrl = await listen(async (req, res) => {
      received = await readFormBody(req);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ id: "cs_test_123", url: "https://checkout.stripe.example/cs_test_123" }));
    });

    const provider = createStripeProvider({ secretKey: "sk_test_fake", baseUrl });
    await provider.createCheckoutSession({
      ...sampleSubscriptionInput(),
      customerId: "cus_already_linked",
      customerEmail: undefined,
    });

    expect(received?.get("customer")).toBe("cus_already_linked");
    expect(received?.has("customer_email")).toBe(false);
  });

  it("sends the secret key only via the Authorization header, never in the body or a logged/visible place", async () => {
    let authHeader: string | undefined;
    const baseUrl = await listen(async (req, res) => {
      authHeader = req.headers.authorization;
      await readFormBody(req);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ id: "cs_test_123", url: "https://checkout.stripe.example/cs_test_123" }));
    });

    const provider = createStripeProvider({ secretKey: "sk_test_super_secret", baseUrl });
    await provider.createCheckoutSession(sampleSubscriptionInput());

    expect(authHeader).toBe("Bearer sk_test_super_secret");
  });
});

describe("createStripeProvider — one-time installation checkout (mode: payment)", () => {
  it("sends mode=payment with no trial/subscription_data, plus the charge-correlating metadata", async () => {
    let received: URLSearchParams | undefined;
    const baseUrl = await listen(async (req, res) => {
      received = await readFormBody(req);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ id: "cs_test_pay_123", url: "https://checkout.stripe.example/cs_test_pay_123" }));
    });

    const provider = createStripeProvider({ secretKey: "sk_test_fake", baseUrl });
    const result = await provider.createCheckoutSession(samplePaymentInput());

    expect(result.id).toBe("cs_test_pay_123");
    expect(received?.get("mode")).toBe("payment");
    expect(received?.get("line_items[0][price]")).toBe("price_test_installation");
    expect(received?.get("managed_payments[enabled]")).toBe("false");
    expect(received?.get("metadata[billingChargeId]")).toBe("charge_abc123");
    expect(received?.has("subscription_data[trial_period_days]")).toBe(false);
  });
});

describe("createStripeProvider — Customer Portal session", () => {
  it("sends the Stripe Customer id and return url, and returns the portal url", async () => {
    let received: URLSearchParams | undefined;
    const baseUrl = await listen(async (req, res) => {
      received = await readFormBody(req);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ url: "https://billing.stripe.example/p/session_123" }));
    });

    const provider = createStripeProvider({ secretKey: "sk_test_fake", baseUrl });
    const result = await provider.createPortalSession({
      customerId: "cus_already_linked",
      returnUrl: "https://app.tallyvis.example/dashboard/billing",
    });

    expect(result).toEqual({ url: "https://billing.stripe.example/p/session_123" });
    expect(received?.get("customer")).toBe("cus_already_linked");
    expect(received?.get("return_url")).toBe("https://app.tallyvis.example/dashboard/billing");
  });

  it("treats a missing portal url as a provider error", async () => {
    const baseUrl = await listen((req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ url: null }));
    });

    const provider = createStripeProvider({ secretKey: "sk_test_fake", baseUrl });
    await expect(
      provider.createPortalSession({ customerId: "cus_x", returnUrl: "https://app.tallyvis.example/dashboard/billing" }),
    ).rejects.toMatchObject({ category: "provider-error" });
  });
});

describe("createStripeProvider — error handling", () => {
  it("maps a 401/403 to a safe, non-leaking 'provider-error' — never surfaces Stripe's raw auth failure body", async () => {
    const baseUrl = await listen((req, res) => {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: { message: "Invalid API Key provided: sk_test_***", type: "authentication_error" } }));
    });

    const provider = createStripeProvider({ secretKey: "sk_test_bad", baseUrl });
    try {
      await provider.createCheckoutSession(sampleSubscriptionInput());
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(BillingProviderError);
      expect((err as BillingProviderError).category).toBe("provider-error");
      expect((err as BillingProviderError).message).not.toContain("sk_test_");
    }
  });

  it("maps a 400 (invalid request) to category 'invalid-request', surfacing Stripe's own safe validation message", async () => {
    const baseUrl = await listen((req, res) => {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: { message: "Invalid email address.", type: "invalid_request_error" } }));
    });

    const provider = createStripeProvider({ secretKey: "sk_test_fake", baseUrl });
    await expect(provider.createCheckoutSession(sampleSubscriptionInput())).rejects.toMatchObject({
      category: "invalid-request",
      message: "Invalid email address.",
    });
  });

  it("maps an unreachable server to a safe 'provider-error', never a raw network exception", async () => {
    // Nothing is listening on this port.
    const provider = createStripeProvider({ secretKey: "sk_test_fake", baseUrl: "http://127.0.0.1:1" });
    await expect(provider.createCheckoutSession(sampleSubscriptionInput())).rejects.toMatchObject({
      category: "provider-error",
      message: "Could not reach the billing provider.",
    });
  });

  it("treats a 2xx response missing a checkout url as a provider error rather than returning an unusable result", async () => {
    const baseUrl = await listen((req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ id: "cs_test_no_url", url: null }));
    });

    const provider = createStripeProvider({ secretKey: "sk_test_fake", baseUrl });
    await expect(provider.createCheckoutSession(sampleSubscriptionInput())).rejects.toMatchObject({
      category: "provider-error",
    });
  });
});
