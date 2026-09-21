import { NextResponse } from "next/server";
import { getDb, handleStripeWebhook, isWebhookConfigured, WebhookVerificationError } from "@tallyvis/api";

/**
 * Phase 14 — reconciling internal subscription state against Stripe (see
 * docs/decisions/0016-onboarding-billing-embed.md). A Route Handler, not a
 * Server Action: Stripe posts a raw HTTP request with a signature header,
 * not a form/RSC action payload, and signature verification needs the
 * exact raw request body — `request.text()` here, never a
 * framework-parsed/re-serialized body.
 *
 * No `STRIPE_WEBHOOK_SECRET` is configured in this development
 * environment, so this endpoint has NOT received or processed a real
 * Stripe webhook event — see `services/billingWebhooks.ts`'s own header
 * comment for the same caveat.
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
