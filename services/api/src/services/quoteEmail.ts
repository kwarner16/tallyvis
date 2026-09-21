import type { DatabaseSync } from "node:sqlite";
import type { AuthSession } from "../auth/session";
import * as quotesRepo from "../repositories/quotes";
import { getCurrentBusiness } from "./business";
import { generateShareLink } from "./quoteSharing";
import { sendEmail } from "../notifications";
import { getEstimateDisplayTotal } from "./estimateDisplay";

/**
 * Phase 14 — sending a quote to the customer's email (see
 * docs/decisions/0016-onboarding-billing-embed.md). Reuses the existing
 * secure quote-share token mechanism (`generateShareLink`,
 * docs/decisions/0012-secure-quote-sharing.md) rather than inventing a
 * second public-authorization path — the link in the email IS a share
 * link, nothing more. Generating a fresh link here revokes any
 * previously-generated one for this quote (the same behavior the
 * dashboard's own "regenerate" already has), so a quote can have at most
 * one working link at a time regardless of whether it got there via the
 * dashboard's copy-link panel or this email.
 *
 * The email is deliberately concise and does NOT include the estimate's
 * line-item breakdown, business notes, AI observation data, or anything
 * about the pricing configuration that produced it — only what a customer
 * needs to recognize the quote and follow the link, where the full
 * (already customer-appropriate — see `CustomerQuoteView`) breakdown lives.
 */

export interface QuoteEmailResult {
  sentAt: string;
  status: "sent";
  providerMessageId?: string;
}

function requireOwnedQuote(db: DatabaseSync, session: AuthSession, quoteId: string) {
  const quote = quotesRepo.getQuoteById(db, session.businessId, quoteId);
  if (!quote) throw new Error(`Quote "${quoteId}" not found.`);
  return quote;
}

/**
 * `buildQuoteUrl` turns a raw share token into the absolute link a
 * customer opens — supplied by the caller (apps/app), which already owns
 * URL construction (`buildQuoteShareUrl`) for the exact same token type.
 */
export async function sendQuoteEmail(
  db: DatabaseSync,
  session: AuthSession,
  quoteId: string,
  buildQuoteUrl: (rawToken: string) => string,
): Promise<QuoteEmailResult> {
  const quote = requireOwnedQuote(db, session, quoteId);
  if (!quote.customer.email) {
    throw new Error("This customer has no email address on file.");
  }

  const business = getCurrentBusiness(db, session);
  const { token } = generateShareLink(db, session, quoteId);
  const quoteUrl = buildQuoteUrl(token);
  const total = getEstimateDisplayTotal(quote.estimate);

  let result: { providerMessageId?: string };
  try {
    result = await sendEmail(
      {
        to: quote.customer.email,
        subject: `Your window cleaning estimate from ${business.name}`,
        text: `Hi ${quote.customer.name || "there"},\n\n${business.name} put together an estimate for your property: ${total}.\n\nView your estimate and respond here:\n${quoteUrl}\n\nThanks,\n${business.name}`,
        html: `<p>Hi ${quote.customer.name || "there"},</p><p>${business.name} put together an estimate for your property: <strong>${total}</strong>.</p><p><a href="${quoteUrl}">View your estimate and respond</a></p><p>Thanks,<br/>${business.name}</p>`,
      },
      "quote-notification",
    );
  } catch (err) {
    quotesRepo.recordQuoteEmailAttempt(db, session.businessId, quoteId, "failed", undefined);
    throw err;
  }

  quotesRepo.recordQuoteEmailAttempt(db, session.businessId, quoteId, "sent", result.providerMessageId);
  return { sentAt: new Date().toISOString(), status: "sent", providerMessageId: result.providerMessageId };
}
