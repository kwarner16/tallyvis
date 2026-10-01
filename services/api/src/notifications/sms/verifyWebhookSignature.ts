import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies an inbound Twilio webhook's `X-Twilio-Signature` header against
 * Twilio's own documented algorithm
 * (https://www.twilio.com/docs/usage/webhooks/webhook-security): take the
 * full URL Twilio actually POSTed to, append every POST parameter sorted by
 * key name (each as `key` immediately followed by `value`, no delimiter),
 * HMAC-SHA1 the result with the account's Auth Token, then base64-encode.
 * Pure and dependency-free (no `twilio` SDK), mirroring this repo's
 * existing `verifyStripeWebhookSignature` — directly unit-testable against
 * a hand-computed signature.
 *
 * `url` must be the EXACT URL configured as the webhook in Twilio Console
 * (scheme, host, path, and query string, if any) — any mismatch (e.g. a
 * proxy rewriting the host, or a trailing slash difference) makes every
 * signature fail verification. This has not been exercised against a real
 * Twilio-signed request in this environment; see
 * docs/decisions/0032-sms-stop-start-sync.md for what Kyle must confirm
 * once this is deployed and configured in Twilio Console.
 */
export function verifyTwilioWebhookSignature(
  url: string,
  params: Record<string, string>,
  signatureHeader: string,
  authToken: string,
): boolean {
  if (!signatureHeader) return false;

  let data = url;
  for (const key of Object.keys(params).sort()) {
    data += key + params[key];
  }

  const expected = createHmac("sha1", authToken).update(data, "utf8").digest("base64");

  let expectedBuf: Buffer;
  let actualBuf: Buffer;
  try {
    expectedBuf = Buffer.from(expected, "base64");
    actualBuf = Buffer.from(signatureHeader, "base64");
  } catch {
    return false;
  }
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
