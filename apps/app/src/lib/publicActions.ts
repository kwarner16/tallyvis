"use server";

import type { Business, PricingConfiguration, Quote } from "@tallyvis/types";
import {
  acceptQuoteByToken,
  createQuotePublic,
  declineQuoteByToken,
  getActiveConfigurationForBusiness,
  getDb,
  getDefaultPublicBusiness,
  getQuoteByShareToken,
  requestQuoteChangesByToken,
  type CreateQuoteInput,
  type PublicQuoteView,
} from "@tallyvis/api";

/**
 * Unauthenticated actions for the public `/estimate/*` customer wizard —
 * see `getDefaultPublicBusiness`'s own comment and
 * docs/decisions/0011-persistence-auth-and-multi-tenancy.md for why "which
 * business" is resolved this way rather than from a session, and why
 * that's a stated Phase 9 simplification rather than real multi-business
 * public routing.
 */

async function requirePublicBusiness(): Promise<Business> {
  const business = getDefaultPublicBusiness(getDb());
  if (!business) throw new Error("No business is configured yet.");
  return business;
}

async function requirePublicBusinessId(): Promise<string> {
  return (await requirePublicBusiness()).id;
}

export async function getPublicBusinessAction(): Promise<Business> {
  return requirePublicBusiness();
}

export async function getPublicActiveConfigurationAction(): Promise<PricingConfiguration> {
  const businessId = await requirePublicBusinessId();
  return getActiveConfigurationForBusiness(getDb(), businessId);
}

/**
 * Returns only the new quote's id, not the whole `Quote`. The estimator's
 * result page already has everything else it renders in memory, and this is
 * an unauthenticated endpoint anyone can call with any payload — handing
 * back the full persisted record (business id, the customer row, the
 * server-side estimate) would be more than the browser needs and more than
 * an anonymous caller should see.
 */
export async function createPublicQuoteAction(input: CreateQuoteInput): Promise<{ id: string }> {
  const businessId = await requirePublicBusinessId();
  const quote = createQuotePublic(getDb(), businessId, input);
  return { id: quote.id };
}

/**
 * For the customer-facing `/quote/[token]` view (Phase 10 — see
 * docs/decisions/0012-secure-quote-sharing.md). The raw share token IS the
 * authorization: `getQuoteByShareToken` resolves it server-side to exactly
 * one quote and its owning business, or nothing at all. There is no id
 * parameter here for a caller to substitute — only the token.
 */
export async function getPublicQuoteByTokenAction(token: string): Promise<PublicQuoteView | null> {
  const result = getQuoteByShareToken(getDb(), token);
  return result ?? null;
}

/** Customer action: accept. Operates only on whatever quote `token` resolves to — see `getQuoteByShareToken`'s comment. */
export async function acceptPublicQuoteAction(token: string): Promise<Quote> {
  return acceptQuoteByToken(getDb(), token);
}

/** Customer action: decline. Same token-only authorization as accept. */
export async function declinePublicQuoteAction(token: string): Promise<Quote> {
  return declineQuoteByToken(getDb(), token);
}

/** Customer action: request changes / contact the business — persisted as a note, not a status change. */
export async function requestPublicQuoteChangesAction(token: string, note: string): Promise<Quote> {
  return requestQuoteChangesByToken(getDb(), token, note);
}
