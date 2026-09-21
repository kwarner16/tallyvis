"use server";

import type { Business, PricingConfiguration, Quote } from "@tallyvis/types";
import {
  createQuotePublic,
  getActiveConfigurationForBusiness,
  getBusinessForPublicQuote,
  getDb,
  getDefaultPublicBusiness,
  getQuotePublic,
  type CreateQuoteInput,
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

/** For the read-only `/quote/[id]` customer view — see `getQuotePublic`'s own comment for the access-control caveat this carries. */
export async function getPublicQuoteAction(
  id: string,
): Promise<{ quote: Quote; business: Business } | null> {
  const db = getDb();
  const quote = getQuotePublic(db, id);
  if (!quote) return null;
  const business = getBusinessForPublicQuote(db, quote.businessId);
  if (!business) return null;
  return { quote, business };
}
