import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies a Stripe webhook signature against Stripe's own documented
 * algorithm (https://stripe.com/docs/webhooks#verify-events) —
 * HMAC-SHA256 of `${timestamp}.${rawBody}` using the webhook signing
 * secret, compared against the `v1` signature in the `Stripe-Signature`
 * header, with a tolerance window against replay of an old payload. Pure
 * and dependency-free (no Stripe SDK) so it's directly unit-testable
 * against a hand-computed signature — see
 * docs/decisions/0016-onboarding-billing-embed.md.
 */
export function verifyStripeWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  toleranceSeconds = 300,
): boolean {
  const parts = new Map<string, string>();
  for (const segment of signatureHeader.split(",")) {
    const [key, value] = segment.split("=");
    if (key && value) parts.set(key.trim(), value.trim());
  }

  const timestamp = parts.get("t");
  const signature = parts.get("v1");
  if (!timestamp || !signature) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  if (Math.abs(Date.now() / 1000 - timestampSeconds) > toleranceSeconds) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");

  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(signature, "hex");
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
