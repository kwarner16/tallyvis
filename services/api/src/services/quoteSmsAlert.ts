import type { Business, Quote } from "@tallyvis/types";
import { sendSms } from "../notifications/sms";
import { normalizePhoneNumber } from "./business";

/**
 * Phase 15 (see docs/decisions/0028-mobile-sms-embed-and-growth-updates.md)
 * — an optional SMS alert to the BUSINESS OWNER (never the customer) when a
 * real customer submits a quote through the public estimator. Deliberately
 * concise and free of AI internals/tokens/unnecessary customer data — see
 * this file's `buildMessageBody`. The link is a plain authenticated
 * dashboard route, not a bearer token: opening it while logged out goes
 * through normal sign-in (see `apps/app/middleware.ts`'s `redirect` param
 * and `logInAction`'s matching allowlist), never a standalone auth
 * mechanism of its own.
 *
 * Only ever called from `createQuotePublic` (see `services/quotes.ts`) —
 * never from the authenticated dashboard's own `createQuote`, and never
 * from `updateQuotePublic` (the re-analysis/correction path) — so a
 * business re-analyzing or a business creating its own quote can never
 * trigger a self-alert, and correcting an existing quote can never
 * duplicate one. Combined with the cooldown below, this is what makes
 * "duplicate/retried quote creation must not generate duplicate alerts"
 * true by construction rather than by a fragile dedup check.
 */

/**
 * Best-effort, single-process throttle — the same documented caveat as
 * `passwordReset.ts`'s `isThrottled`/`aiAnalysis.ts`'s dedup cache: not a
 * distributed rate limiter, just enough to stop a rapid retry/resubmit from
 * texting a business owner more than once in quick succession, in an
 * architecture with no separate rate-limiting infrastructure to hook into.
 */
const COOLDOWN_MS = 30_000;
const lastSentAt = new Map<string, number>();

function isThrottled(businessId: string): boolean {
  const last = lastSentAt.get(businessId);
  return last !== undefined && Date.now() - last < COOLDOWN_MS;
}

/**
 * Concise on purpose: customer name, service address, a couple of
 * pricing-relevant facts, the estimate, the customer's own phone (so the
 * owner can call back straight from the text without opening the
 * dashboard first), and the review link. Deliberately omits the customer's
 * email (keeps the message to ~2 SMS segments), AI confidence/evidence
 * internals, and any token/credential.
 */
function buildMessageBody(quote: Quote, quoteUrl: string): string {
  const { windowCount, stories } = quote.analysis.characteristics;
  const storyLabel = stories === 1 ? "story" : "stories";
  const lines = [
    `New Tallyvis quote — ${quote.customer.name}`,
    quote.property.address,
    `${windowCount} windows · ${stories} ${storyLabel}`,
    `Estimate: $${Math.round(quote.estimate.total)}`,
  ];
  if (quote.customer.phone) lines.push(quote.customer.phone);
  lines.push(`Review: ${quoteUrl}`);
  return lines.join("\n");
}

/**
 * `buildQuoteUrl` turns a quote id into the absolute dashboard link a
 * caller (apps/app) already owns URL construction for — same pattern
 * `sendQuoteEmail`'s `buildQuoteUrl` already establishes. Never awaited by
 * the caller — see the returned `finished`'s own reasoning, identical to
 * `requestPasswordReset`'s: the caller registers it with Next's `after()`
 * so a Vercel function isn't frozen before the send actually completes,
 * without making quote creation itself wait on it.
 */
export function sendNewQuoteSmsAlert(
  business: Business,
  quote: Quote,
  buildQuoteUrl: (quoteId: string) => string,
): { finished: Promise<void> } {
  if (!business.smsNotificationsEnabled) return { finished: Promise.resolve() };

  const normalizedPhone = business.notificationPhone ? normalizePhoneNumber(business.notificationPhone) : null;
  if (!normalizedPhone) return { finished: Promise.resolve() };

  if (isThrottled(business.id)) return { finished: Promise.resolve() };
  lastSentAt.set(business.id, Date.now());

  const finished = sendSms(
    { to: normalizedPhone, body: buildMessageBody(quote, buildQuoteUrl(quote.id)) },
    "new-quote-alert",
  ).then(
    () => {},
    (err: unknown) => {
      console.error("sendNewQuoteSmsAlert: background SMS send failed:", err);
    },
  );

  return { finished };
}
