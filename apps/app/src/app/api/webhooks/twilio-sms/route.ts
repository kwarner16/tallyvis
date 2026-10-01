import { NextResponse } from "next/server";
import { getDb, handleTwilioSmsWebhook, TwilioWebhookVerificationError } from "@tallyvis/api";

/**
 * STOP/START synchronization for the V1 customer SMS program (see
 * docs/decisions/0032-sms-stop-start-sync.md). A Route Handler, not a
 * Server Action: Twilio posts a raw `application/x-www-form-urlencoded`
 * request with an `X-Twilio-Signature` header, not a form/RSC action
 * payload, and signature verification needs the exact raw request body and
 * URL — `request.text()`/`request.url` here, never a framework-parsed/
 * re-serialized body.
 *
 * Returns a non-2xx response on a signature failure or unexpected error,
 * never a false 200 — same reasoning as `/api/webhooks/stripe`. This has
 * NOT been exercised against a real Twilio-signed request in this
 * environment; see the ADR for exactly what Kyle must configure in Twilio
 * Console (which webhook URL field, and how Advanced Opt-Out routing
 * affects whether Twilio forwards STOP/START here at all) and verify once
 * deployed.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    return NextResponse.json({ error: "SMS webhook not configured" }, { status: 501 });
  }

  const signature = request.headers.get("x-twilio-signature");
  const rawBody = await request.text();

  try {
    await handleTwilioSmsWebhook(getDb(), rawBody, signature, request.url, authToken);
  } catch (err) {
    if (err instanceof TwilioWebhookVerificationError) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }
    console.error("Twilio SMS webhook handling failed:", err);
    return NextResponse.json({ error: "Webhook handling failed" }, { status: 500 });
  }

  // Twilio's own Advanced Opt-Out / default keyword handling sends the
  // actual STOP/START/HELP auto-reply at the carrier level — this response
  // deliberately contains no TwiML <Message>, so this app never sends a
  // second, duplicate reply of its own.
  return NextResponse.json({ received: true });
}
