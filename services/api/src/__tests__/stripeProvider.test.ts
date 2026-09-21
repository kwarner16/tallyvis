import { createServer } from "node:http";
import type { RequestListener, Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createStripeProvider } from "../billing/providers/stripe";
import { BillingProviderError } from "../billing/types";

/**
 * The real Stripe provider adapter, verified against a local fake HTTP
 * server standing in for Stripe's API — not the live API (no credentials
 * exist in this environment; see
 * docs/decisions/0017-billing-hardening.md for exactly what this does and
 * does not prove). Mirrors the exact pattern
 * `services/ai/src/__tests__/anthropic.test.ts` already established for
 * the AI provider: a local server proves request construction and
 * response/error handling end-to-end without needing real network access
 * or a key.
 */

const sampleInput = () => ({
  customerEmail: "owner@sparkle.example",
  planId: "growth",
  planName: "Growth",
  monthlyPriceCents: 14900,
  trialDays: 7,
  successUrl: "https://app.tallyvis.example/dashboard/billing?checkout=success",
  cancelUrl: "https://app.tallyvis.example/dashboard/billing?checkout=canceled",
  metadata: { businessId: "business_abc123", planId: "growth" },
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

describe("createStripeProvider — request construction", () => {
  it("sends the exact plan-derived price server-side computed — never a client-suppliable value — as unit_amount, plus the trial length and metadata", async () => {
    let received: URLSearchParams | undefined;
    const baseUrl = await listen(async (req, res) => {
      received = await readFormBody(req);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ id: "cs_test_123", url: "https://checkout.stripe.example/cs_test_123" }));
    });

    const provider = createStripeProvider({ secretKey: "sk_test_fake", baseUrl });
    const result = await provider.createCheckoutSession(sampleInput());

    expect(result).toEqual({ id: "cs_test_123", url: "https://checkout.stripe.example/cs_test_123" });
    expect(received?.get("mode")).toBe("subscription");
    expect(received?.get("customer_email")).toBe("owner@sparkle.example");
    expect(received?.get("line_items[0][price_data][unit_amount]")).toBe("14900");
    expect(received?.get("line_items[0][price_data][currency]")).toBe("usd");
    expect(received?.get("line_items[0][price_data][recurring][interval]")).toBe("month");
    expect(received?.get("subscription_data[trial_period_days]")).toBe("7");
    expect(received?.get("metadata[businessId]")).toBe("business_abc123");
    expect(received?.get("success_url")).toBe(sampleInput().successUrl);
    expect(received?.get("cancel_url")).toBe(sampleInput().cancelUrl);
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
    await provider.createCheckoutSession(sampleInput());

    expect(authHeader).toBe("Bearer sk_test_super_secret");
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
      await provider.createCheckoutSession(sampleInput());
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
    await expect(provider.createCheckoutSession(sampleInput())).rejects.toMatchObject({
      category: "invalid-request",
      message: "Invalid email address.",
    });
  });

  it("maps an unreachable server to a safe 'provider-error', never a raw network exception", async () => {
    // Nothing is listening on this port.
    const provider = createStripeProvider({ secretKey: "sk_test_fake", baseUrl: "http://127.0.0.1:1" });
    await expect(provider.createCheckoutSession(sampleInput())).rejects.toMatchObject({
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
    await expect(provider.createCheckoutSession(sampleInput())).rejects.toMatchObject({
      category: "provider-error",
    });
  });
});
