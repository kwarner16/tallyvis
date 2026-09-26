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
import type { RawPropertyObservation } from "@tallyvis/ai";
import type { AuthSession } from "../auth/session";
import type { Queryable } from "../db/pg/client";
import * as quotesRepo from "../repositories/quotes";
import * as customersService from "./customers";
import * as pricingService from "./pricing";
import { getSubscription, hasProductAccess } from "./subscriptions";

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
  /**
   * Phase 13 (see docs/decisions/0015-job-outcome-tracking.md) — the AI's
   * raw per-field observation, when analysis actually used one, preserved
   * alongside the quote so it can later be compared against whatever
   * `analysis.characteristics` a human ultimately confirmed. Omit when the
   * quote was entered without AI (manual entry, or the public estimator's
   * AI-failure fallback) — never fabricated after the fact.
   */
  aiObservation?: RawPropertyObservation;
}

/**
 * Generous enough for any real street address (including a long unit/
 * building/floor qualifier) while still rejecting obvious abuse — not a
 * meaningful business constraint, just a sanity ceiling.
 */
const MAX_SERVICE_ADDRESS_LENGTH = 300;

/** Control characters (including newline/tab) have no legitimate place in a single-line address field — reject rather than silently strip, so the caller knows the input was rejected rather than silently mangled. */
// eslint-disable-next-line no-control-regex -- deliberately matching control characters to reject them
const CONTROL_CHARACTERS = /[\x00-\x1F\x7F]/;

/**
 * The one place a service address is validated, regardless of whether the
 * quote is coming from the public estimator or the business's own "New
 * quote" dashboard flow — both funnel through `persistPricedQuote` below.
 * Deliberately permissive about content (real addresses use letters,
 * digits, spaces, and punctuation like `.`, `,`, `-`, `'`, `#`, `/`) and
 * strict only about shape: present, non-empty once trimmed, not absurdly
 * long, no control characters. No format/geocoding validation — see
 * docs/decisions/0020-required-service-address.md for why V1 deliberately
 * doesn't verify the address is real.
 */
function validateServiceAddress(address: unknown): string {
  if (typeof address !== "string") {
    throw new Error("Service address is required.");
  }
  const trimmed = address.trim();
  if (trimmed.length === 0) {
    throw new Error("Service address is required.");
  }
  if (trimmed.length > MAX_SERVICE_ADDRESS_LENGTH) {
    throw new Error(`Service address must be ${MAX_SERVICE_ADDRESS_LENGTH} characters or fewer.`);
  }
  if (CONTROL_CHARACTERS.test(trimmed)) {
    throw new Error("Service address contains characters that aren't allowed.");
  }
  return trimmed;
}

export async function listQuotes(db: Queryable, session: AuthSession): Promise<Quote[]> {
  return quotesRepo.listQuotes(db, session.businessId);
}

export async function getQuote(db: Queryable, session: AuthSession, id: string): Promise<Quote | undefined> {
  return quotesRepo.getQuoteById(db, session.businessId, id);
}

async function getQuoteOrThrow(db: Queryable, session: AuthSession, id: string): Promise<Quote> {
  const quote = await getQuote(db, session, id);
  if (!quote) throw new Error(`Quote "${id}" not found.`);
  return quote;
}

/** The AI's raw observation this quote was saved with, if any — see `CreateQuoteInput.aiObservation`'s comment. `undefined` for a manually-entered quote, never fabricated. */
export async function getQuoteAiObservation(
  db: Queryable,
  session: AuthSession,
  quoteId: string,
): Promise<RawPropertyObservation | undefined> {
  await getQuoteOrThrow(db, session, quoteId);
  return quotesRepo.getQuoteAiObservation(db, session.businessId, quoteId);
}

/**
 * Prices through `calculateEstimate()` against the business's active
 * configuration and pins that version onto the new quote. A signed-in
 * business quoting someone it already knows reuses that existing
 * `Customer` record rather than forking a duplicate — safe here precisely
 * because the caller is the business that owns the record.
 */
export async function createQuote(db: Queryable, session: AuthSession, input: CreateQuoteInput): Promise<Quote> {
  await requireProductAccess(db, session);
  const customer = await customersService.findOrCreateCustomer(db, session, input.customer);
  return persistPricedQuote(db, session.businessId, customer.id, input);
}

/**
 * Server-authoritative subscription gate (Phase 14 — see
 * docs/decisions/0016-onboarding-billing-embed.md): `hasProductAccess`
 * treats a business with no subscription row at all as legacy/pre-billing
 * access, so this is a no-op for every business that predates Phase 14 or
 * hasn't gone through onboarding yet — it only blocks a business whose own
 * trial/subscription has actually expired or been canceled. Deliberately
 * applied only here, on the authenticated dashboard's own quote creation,
 * not on the public estimator's `createQuotePublic` — narrowing where
 * enforcement lands keeps this phase's foundation low-risk; extending it
 * to the public flow is a natural next step, not done here.
 */
async function requireProductAccess(db: Queryable, session: AuthSession): Promise<void> {
  const subscription = await getSubscription(db, session);
  if (!hasProductAccess(subscription)) {
    throw new Error("Your Tallyvis trial or subscription has ended. Reactivate your plan to create new quotes.");
  }
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
export async function createQuotePublic(db: Queryable, businessId: string, input: CreateQuoteInput): Promise<Quote> {
  const customer = await customersService.createCustomerForBusiness(db, businessId, input.customer);
  return persistPricedQuote(db, businessId, customer.id, input);
}

/**
 * Updates the quote `createQuotePublic` already created for THIS SAME
 * customer session with an improved analysis — e.g. the customer went
 * back to `/estimate/photos` to add another photo after already landing
 * on `/estimate/result` once. Without this, a second, better analysis had
 * nowhere to go: the wizard's own "already created a quote this session"
 * guard correctly prevents a SECOND quote row, but nothing ever wrote the
 * improvement back to the first one, so the business was permanently
 * stuck seeing the customer's ORIGINAL, worse-evidence submission (2026-09
 * incident audit).
 *
 * Scoped by `WHERE id = $1 AND business_id = $2` at the repository layer
 * exactly like every other public-quote operation — `businessId` is
 * always server-resolved from the embed id, never client-supplied, so
 * this can never touch a quote belonging to a different business even if
 * `quoteId` were guessed. `quoteId` itself is a random UUID the customer's
 * own browser already received from THIS quote's own creation moments
 * earlier in the same session (never rendered in a URL, never
 * bookmarkable) — the same "knowledge of an unguessable id from your own
 * session is the authorization" pattern `createPublicQuoteAction` already
 * establishes by handing that id back to an anonymous caller in the first
 * place; it does not reduce security below what already existed.
 *
 * Re-derives `status` via `determineInitialQuoteStatus` (unlike the
 * authenticated `updateQuoteAnalysis`, which never touches status) —
 * exactly because the whole point of a customer-driven re-analysis is
 * that it can resolve the evidence gap that originally caused
 * `needs_review`, which a business's own manual field edit never implies.
 */
export async function updateQuotePublic(
  db: Queryable,
  businessId: string,
  quoteId: string,
  input: CreateQuoteInput,
): Promise<Quote> {
  // Checked FIRST, before any pricing lookup: a wrong/guessed businessId
  // must fail as "quote not found" (the real, scoping-relevant reason),
  // never leak a different, businessId-shaped error (e.g. "no pricing
  // configuration") from a step that only runs for a business that
  // genuinely owns this quote.
  const existing = await quotesRepo.getQuoteById(db, businessId, quoteId);
  if (!existing) throw new Error("Quote not found.");

  const configuration = await pricingService.getActiveConfigurationForBusiness(db, businessId);
  const pricingInput = reconcilePricingInput(input.servicePreferences, input.analysis.characteristics);
  const estimate = calculateEstimate(pricingInput, configuration, input.analysis.metadata.confidence);
  const status = determineInitialQuoteStatus(input.analysis, input.aiObservation);

  const updated = await quotesRepo.updateQuoteFromReanalysis(
    db,
    businessId,
    quoteId,
    input.analysis,
    estimate,
    configuration.id,
    status,
    input.aiObservation,
  );
  if (!updated) throw new Error("Quote not found.");
  return updated;
}

/**
 * Vision V1.1 (docs/decisions/0023-guided-capture-evidence-confidence.md)
 * — "AI → customer resolves uncertainty → deterministic pricing →
 * automatic estimate; business owner is the EXCEPTION path, not the
 * default." `needs_review` and its full dashboard workflow (badge, filter,
 * `QuoteActions`' approve/send/request-more-info/reject buttons) already
 * existed but were unreachable — every quote was hardcoded to `"new"`
 * regardless of how uncertain its analysis was. This is the one place
 * that decides which a new quote gets, from data every caller already
 * provides — no new input field needed.
 *
 * Escalates to `"needs_review"` when the confirmed characteristics still
 * carry real pricing-relevant doubt: the reconciled confidence is anything
 * short of "high" (this already accounts for unresolved core fields AND
 * `reconcile.ts`'s evidence-driven downgrade — see
 * docs/decisions/0022/0023), or the AI's own evidence assessment flagged
 * the photo coverage as genuinely `"insufficient"` — not merely
 * `"usable_with_uncertainty"` — even if confidence math didn't separately
 * catch it (belt-and-suspenders for `"insufficient"` specifically: that
 * tier means the photos may not show enough of the property for ANYONE,
 * including the person confirming a number, to know it's the true total —
 * see reconcile.ts's own "please confirm the full count or add more
 * photos" note — so it stays a meaningful unresolved condition even after
 * confirmation). A quote with no AI observation at all (manual entry) has
 * already been reviewed by whoever typed it in, so it's never escalated
 * here.
 *
 * `"usable_with_uncertainty"` alone is deliberately NOT escalated here
 * (launch-readiness review, 2026-09): it's the AI's own middle tier for
 * "imperfect coverage, but still a usable basis for a value" — distinct
 * from `"insufficient"`. Escalating on it unconditionally meant a quote
 * stayed forced into `needs_review` purely because of a HISTORICAL evidence
 * gap even after a customer fully confirmed every pricing-critical field
 * (`/estimate/confirm` only caps confidence below "high" for strictly
 * `"insufficient"` evidence, matching this), or after a business reviewed
 * and saved a quote themselves (the dashboard's "New quote" flow always
 * records confidence "high" on save — see `NewQuoteClient.tsx` — precisely
 * because whatever's on screen when a human clicks Save has been reviewed).
 * That violated the "historical uncertainty alone should not require
 * review if the problem was subsequently resolved" principle: once
 * `analysis.metadata.confidence` is genuinely "high" — which, for both
 * callers, already factors in unresolved fields and the evidence tier
 * itself (see `reconcile.ts`'s `confidenceFromEvidence` and the confirm
 * page's own cap) — nothing pricing-relevant remains unresolved, and the
 * quote is eligible for automatic processing like any other.
 *
 * V1 default, deliberately conservative rather than configurable: every
 * business gets this behavior uniformly today. A future per-business
 * "automatically send" vs. "always review" setting (mission Part 11) can
 * call this same function conditionally without changing its logic —
 * intentionally kept as one small, pure, independently testable function
 * for exactly that reason, rather than inlined into `persistPricedQuote`.
 */
export function determineInitialQuoteStatus(
  analysis: PropertyAnalysisResult,
  aiObservation: RawPropertyObservation | undefined,
): QuoteStatus {
  if (!aiObservation) return "new";
  if (analysis.metadata.confidence !== "high") return "needs_review";
  if (aiObservation.evidence.overallEvidence === "insufficient") return "needs_review";
  return "new";
}

/**
 * Shared tail of both creation paths. Takes a `businessId` the caller has
 * already resolved server-side (from a session, or from
 * `getDefaultPublicBusiness`) — never one the browser supplied. The
 * estimate is always computed here from the configuration this business
 * has active right now; no caller can hand in a pre-computed total.
 */
async function persistPricedQuote(
  db: Queryable,
  businessId: string,
  customerId: string,
  input: CreateQuoteInput,
): Promise<Quote> {
  const address = validateServiceAddress(input.property.address);
  const configuration = await pricingService.getActiveConfigurationForBusiness(db, businessId);
  const pricingInput = reconcilePricingInput(input.servicePreferences, input.analysis.characteristics);
  const estimate = calculateEstimate(pricingInput, configuration, input.analysis.metadata.confidence);

  return quotesRepo.createQuoteRecord(db, businessId, {
    customerId,
    pricingConfigId: configuration.id,
    property: { ...input.property, address },
    servicePreferences: input.servicePreferences,
    notes: input.notes,
    photos: input.photos,
    analysis: input.analysis,
    estimate,
    status: determineInitialQuoteStatus(input.analysis, input.aiObservation),
    aiObservation: input.aiObservation,
  });
}

/**
 * Overwrites the quote's structured characteristics and re-prices it
 * against the SAME pricing configuration it was originally created under —
 * correcting what a job involves must not silently pull in whatever prices
 * are active today. Use `recalculateQuoteEstimate` to explicitly opt a
 * quote into current pricing.
 */
export async function updateQuoteAnalysis(
  db: Queryable,
  session: AuthSession,
  quoteId: string,
  characteristics: PropertyAnalysisResult["characteristics"],
): Promise<Quote> {
  const quote = await getQuoteOrThrow(db, session, quoteId);
  const configuration = await pricingService.getConfigurationById(db, session, quote.pricingConfigId);
  if (!configuration) {
    throw new Error(`Pricing configuration "${quote.pricingConfigId}" not found.`);
  }

  const analysis: PropertyAnalysisResult = { ...quote.analysis, characteristics };
  const pricingInput = reconcilePricingInput(quote.servicePreferences, characteristics);
  const estimate = calculateEstimate(pricingInput, configuration, analysis.metadata.confidence);

  const updated = await quotesRepo.updateQuoteAnalysisAndEstimate(
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
export async function recalculateQuoteEstimate(db: Queryable, session: AuthSession, quoteId: string): Promise<Quote> {
  const quote = await getQuoteOrThrow(db, session, quoteId);
  const configuration = await pricingService.getActiveConfiguration(db, session);
  const pricingInput = reconcilePricingInput(quote.servicePreferences, quote.analysis.characteristics);
  const estimate = calculateEstimate(pricingInput, configuration, quote.analysis.metadata.confidence);

  const updated = await quotesRepo.updateQuoteAnalysisAndEstimate(
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
export async function updateQuoteCustomer(
  db: Queryable,
  session: AuthSession,
  quoteId: string,
  input: CustomerInput,
): Promise<Quote> {
  const quote = await getQuoteOrThrow(db, session, quoteId);
  await customersService.updateCustomer(db, session, quote.customerId, input);
  return getQuoteOrThrow(db, session, quoteId);
}

export async function updateQuoteStatus(
  db: Queryable,
  session: AuthSession,
  quoteId: string,
  status: QuoteStatus,
): Promise<Quote> {
  const quote = await getQuoteOrThrow(db, session, quoteId);
  if (!canTransitionQuoteStatus(quote.status, status)) {
    throw new Error(`Cannot move a quote from "${quote.status}" to "${status}".`);
  }
  const updated = await quotesRepo.updateQuoteStatus(db, session.businessId, quoteId, status);
  if (!updated) throw new Error(`Quote "${quoteId}" not found.`);
  return updated;
}
