import type { DatabaseSync } from "node:sqlite";
import type {
  CustomerInput,
  Property,
  PropertyAnalysisResult,
  Quote,
  QuotePhoto,
  QuoteStatus,
  ServicePreferences,
} from "@tallyvis/types";
import { canTransitionQuoteStatus } from "@tallyvis/types";
import { calculateEstimate, reconcilePricingInput } from "@tallyvis/pricing";
import type { AuthSession } from "../auth/session";
import * as quotesRepo from "../repositories/quotes";
import * as customersService from "./customers";
import * as pricingService from "./pricing";

export interface CreateQuoteInput {
  customer: CustomerInput;
  property: Property;
  servicePreferences: ServicePreferences;
  notes: string;
  photos: QuotePhoto[];
  /**
   * Job characteristics + confidence only — deliberately NOT an estimate.
   * The estimate is always computed here, server-side, from this input; a
   * caller cannot hand this function a pre-computed total and have it
   * trusted. A client-side "live preview" (see apps/app's create-quote
   * page) may call `calculateEstimate()` itself for instant UI feedback,
   * but only the recomputation below is ever persisted.
   */
  analysis: PropertyAnalysisResult;
}

export function listQuotes(db: DatabaseSync, session: AuthSession): Quote[] {
  return quotesRepo.listQuotes(db, session.businessId);
}

export function getQuote(db: DatabaseSync, session: AuthSession, id: string): Quote | undefined {
  return quotesRepo.getQuoteById(db, session.businessId, id);
}

function getQuoteOrThrow(db: DatabaseSync, session: AuthSession, id: string): Quote {
  const quote = getQuote(db, session, id);
  if (!quote) throw new Error(`Quote "${id}" not found.`);
  return quote;
}

/**
 * Prices through `calculateEstimate()` against the business's active
 * configuration and pins that version onto the new quote. A signed-in
 * business quoting someone it already knows reuses that existing
 * `Customer` record rather than forking a duplicate — safe here precisely
 * because the caller is the business that owns the record.
 */
export function createQuote(db: DatabaseSync, session: AuthSession, input: CreateQuoteInput): Quote {
  const customer = customersService.findOrCreateCustomer(db, session, input.customer);
  return persistPricedQuote(db, session.businessId, customer.id, input);
}

/**
 * The public estimator's counterpart to `createQuote`: the same pricing
 * and persistence logic, but for the one place a quote is created without
 * a signed-in session — the customer-facing `/estimate/*` wizard, which
 * resolves `businessId` server-side via `getDefaultPublicBusiness` rather
 * than from a session or, critically, from anything the browser sent. See
 * docs/decisions/0011-persistence-auth-and-multi-tenancy.md.
 *
 * The one deliberate behavioural difference from `createQuote`: this always
 * creates a fresh `Customer` row instead of matching the submitted email
 * against existing ones. An anonymous visitor has proved nothing about who
 * they are, so letting a typed email resolve to a record the business
 * already holds would turn this endpoint into a lookup for that customer's
 * real name, phone, and address — see `createCustomerForBusiness`.
 */
export function createQuotePublic(db: DatabaseSync, businessId: string, input: CreateQuoteInput): Quote {
  const customer = customersService.createCustomerForBusiness(db, businessId, input.customer);
  return persistPricedQuote(db, businessId, customer.id, input);
}

/**
 * Shared tail of both creation paths. Takes a `businessId` the caller has
 * already resolved server-side (from a session, or from
 * `getDefaultPublicBusiness`) — never one the browser supplied. The
 * estimate is always computed here from the configuration this business
 * has active right now; no caller can hand in a pre-computed total.
 */
function persistPricedQuote(
  db: DatabaseSync,
  businessId: string,
  customerId: string,
  input: CreateQuoteInput,
): Quote {
  const configuration = pricingService.getActiveConfigurationForBusiness(db, businessId);
  const pricingInput = reconcilePricingInput(input.servicePreferences, input.analysis.characteristics);
  const estimate = calculateEstimate(pricingInput, configuration, input.analysis.metadata.confidence);

  return quotesRepo.createQuoteRecord(db, businessId, {
    customerId,
    pricingConfigId: configuration.id,
    property: input.property,
    servicePreferences: input.servicePreferences,
    notes: input.notes,
    photos: input.photos,
    analysis: input.analysis,
    estimate,
    status: "new",
  });
}

/**
 * Overwrites the quote's structured characteristics and re-prices it
 * against the SAME pricing configuration it was originally created under —
 * correcting what a job involves must not silently pull in whatever prices
 * are active today. Use `recalculateQuoteEstimate` to explicitly opt a
 * quote into current pricing.
 */
export function updateQuoteAnalysis(
  db: DatabaseSync,
  session: AuthSession,
  quoteId: string,
  characteristics: PropertyAnalysisResult["characteristics"],
): Quote {
  const quote = getQuoteOrThrow(db, session, quoteId);
  const configuration = pricingService.getConfigurationById(db, session, quote.pricingConfigId);
  if (!configuration) {
    throw new Error(`Pricing configuration "${quote.pricingConfigId}" not found.`);
  }

  const analysis: PropertyAnalysisResult = { ...quote.analysis, characteristics };
  const pricingInput = reconcilePricingInput(quote.servicePreferences, characteristics);
  const estimate = calculateEstimate(pricingInput, configuration, analysis.metadata.confidence);

  const updated = quotesRepo.updateQuoteAnalysisAndEstimate(
    db,
    session.businessId,
    quoteId,
    analysis,
    estimate,
    configuration.id,
  );
  if (!updated) throw new Error(`Quote "${quoteId}" not found.`);
  return updated;
}

/**
 * Re-prices the quote's existing characteristics against the business's
 * CURRENT pricing configuration and re-pins `pricingConfigId` to it — an
 * explicit opt-in to today's rules, used when rules changed since the
 * quote was created.
 */
export function recalculateQuoteEstimate(db: DatabaseSync, session: AuthSession, quoteId: string): Quote {
  const quote = getQuoteOrThrow(db, session, quoteId);
  const configuration = pricingService.getActiveConfiguration(db, session);
  const pricingInput = reconcilePricingInput(quote.servicePreferences, quote.analysis.characteristics);
  const estimate = calculateEstimate(pricingInput, configuration, quote.analysis.metadata.confidence);

  const updated = quotesRepo.updateQuoteAnalysisAndEstimate(
    db,
    session.businessId,
    quoteId,
    quote.analysis,
    estimate,
    configuration.id,
  );
  if (!updated) throw new Error(`Quote "${quoteId}" not found.`);
  return updated;
}

/** Updates the quote's customer record (shared across all of that customer's quotes) — never re-prices, since customer contact info doesn't feed pricing. */
export function updateQuoteCustomer(
  db: DatabaseSync,
  session: AuthSession,
  quoteId: string,
  input: CustomerInput,
): Quote {
  const quote = getQuoteOrThrow(db, session, quoteId);
  customersService.updateCustomer(db, session, quote.customerId, input);
  return getQuoteOrThrow(db, session, quoteId);
}

export function updateQuoteStatus(
  db: DatabaseSync,
  session: AuthSession,
  quoteId: string,
  status: QuoteStatus,
): Quote {
  const quote = getQuoteOrThrow(db, session, quoteId);
  if (!canTransitionQuoteStatus(quote.status, status)) {
    throw new Error(`Cannot move a quote from "${quote.status}" to "${status}".`);
  }
  const updated = quotesRepo.updateQuoteStatus(db, session.businessId, quoteId, status);
  if (!updated) throw new Error(`Quote "${quoteId}" not found.`);
  return updated;
}
