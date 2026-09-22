import { NextResponse } from "next/server";
import { getDb, handleStripeWebhook, isWebhookConfigured, WebhookVerificationError } from "@tallyvis/api";

/**
 * Phase 14 — reconciling internal subscription state against Stripe (see
 * docs/decisions/0016-onboarding-billing-embed.md, hardened in
 * docs/decisions/0018-stripe-v1-hardening.md). A Route Handler, not a
 * Server Action: Stripe posts a raw HTTP request with a signature header,
 * not a form/RSC action payload, and signature verification needs the
 * exact raw request body — `request.text()` here, never a
 * framework-parsed/re-serialized body.
 *
 * A real, signed Stripe test-mode webhook (via the Stripe CLI's `stripe
 * listen`) has been verified reaching this endpoint successfully — see
 * docs/decisions/0018 for what was and wasn't exercised against live
 * Stripe.
 *
 * Any error `handleStripeWebhook` throws (signature failure, or an
 * unexpected DB/runtime error) results in a non-2xx response here, never a
 * false 200 — Stripe's own documented retry behavior is what recovers a
 * transient failure (e.g. a momentary local DB error), so this handler
 * deliberately never swallows an error into a success response.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!isWebhookConfigured()) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 501 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing Stripe-Signature header" }, { status: 400 });
  }

  const rawBody = await request.text();

  try {
    handleStripeWebhook(getDb(), rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }
    console.error("Stripe webhook handling failed:", err);
    return NextResponse.json({ error: "Webhook handling failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
