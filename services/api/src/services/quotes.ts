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

/**
 * The other deliberate exception to session-scoped access (see
 * `getDefaultPublicBusiness`): the read-only, unauthenticated
 * `/quote/[id]` customer view. `quote.id` is an unguessable-but-not-secret
 * token — this is intentionally not a real access-control mechanism, only
 * a reasonable placeholder until real customer-facing auth/link delivery
 * exists. Read-only: nothing public can reach the mutation functions
 * above, which all require a session.
 */
export function getQuotePublic(db: DatabaseSync, id: string): Quote | undefined {
  return quotesRepo.getQuoteByIdAnyBusiness(db, id);
}

function getQuoteOrThrow(db: DatabaseSync, session: AuthSession, id: string): Quote {
  const quote = getQuote(db, session, id);
  if (!quote) throw new Error(`Quote "${id}" not found.`);
  return quote;
}

/** Prices through `calculateEstimate()` against the business's active configuration and pins that version onto the new quote. */
export function createQuote(db: DatabaseSync, session: AuthSession, input: CreateQuoteInput): Quote {
  return createQuoteForBusiness(db, session.businessId, input);
}

/**
 * The public estimator's counterpart to `createQuote`: the same pricing
 * and persistence logic, but for the one place a quote is created without
 * a signed-in session — the customer-facing `/estimate/*` wizard, which
 * resolves `businessId` server-side via `getDefaultPublicBusiness` rather
 * than from a session or, critically, from anything the browser sent. See
 * docs/decisions/0011-persistence-auth-and-multi-tenancy.md.
 */
export function createQuotePublic(db: DatabaseSync, businessId: string, input: CreateQuoteInput): Quote {
  return createQuoteForBusiness(db, businessId, input);
}

function createQuoteForBusiness(db: DatabaseSync, businessId: string, input: CreateQuoteInput): Quote {
  const session: AuthSession = { userId: businessId, businessId };
  const customer = customersService.findOrCreateCustomer(db, session, input.customer);
  const configuration = pricingService.getActiveConfiguration(db, session);
  const pricingInput = reconcilePricingInput(input.servicePreferences, input.analysis.characteristics);
  const estimate = calculateEstimate(pricingInput, configuration, input.analysis.metadata.confidence);

  return quotesRepo.createQuoteRecord(db, businessId, {
    customerId: customer.id,
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
