import type { DatabaseSync } from "node:sqlite";
import type { Quote } from "@tallyvis/types";
import { compareObservationToCharacteristics, wasObservationCorrected, type ObservationComparisonRow } from "@tallyvis/ai";
import type { AuthSession } from "../auth/session";
import * as quotesRepo from "../repositories/quotes";
import * as jobOutcomesRepo from "../repositories/jobOutcomes";
import type { JobOutcome, SaveJobOutcomeInput } from "../repositories/jobOutcomes";

export type { JobOutcome, JobOutcomeStatus, SaveJobOutcomeInput } from "../repositories/jobOutcomes";
export type { ObservationComparisonRow } from "@tallyvis/ai";

/**
 * Phase 13 — real-world job outcome & data collection foundation. See
 * docs/decisions/0015-job-outcome-tracking.md. Follows the exact same
 * ownership pattern as `services/quoteSharing.ts`: every function here
 * takes the caller's `AuthSession`, re-derives `businessId` from it, and
 * re-checks that the quote in question actually belongs to that business
 * before touching anything — never a client-supplied businessId, never an
 * assumption that a quoteId alone proves ownership.
 */

/** A business can only record/inspect an outcome for a quote it owns. Throws (not "not found" vs. "not yours") — same convention as every other quote lookup in this package. */
function requireOwnedQuote(db: DatabaseSync, session: AuthSession, quoteId: string): Quote {
  const quote = quotesRepo.getQuoteById(db, session.businessId, quoteId);
  if (!quote) throw new Error(`Quote "${quoteId}" not found.`);
  return quote;
}

/** Records (or updates) the actual outcome of a completed job. Never touches the quote's own historical `analysis`/`estimate`/`pricingConfigId` — this is purely additive, sibling data. */
export function recordJobOutcome(
  db: DatabaseSync,
  session: AuthSession,
  quoteId: string,
  input: SaveJobOutcomeInput,
): JobOutcome {
  requireOwnedQuote(db, session, quoteId);
  return jobOutcomesRepo.saveJobOutcome(db, session.businessId, quoteId, input);
}

export function getJobOutcome(db: DatabaseSync, session: AuthSession, quoteId: string): JobOutcome | undefined {
  requireOwnedQuote(db, session, quoteId);
  return jobOutcomesRepo.getJobOutcomeByQuoteId(db, session.businessId, quoteId);
}

/**
 * The AI-observation-vs-confirmed-value comparison for one quote, or
 * `undefined` if AI analysis wasn't used to produce it — "not determinable"
 * per this phase's brief, not "nothing was corrected."
 */
export function getQuoteObservationComparison(
  db: DatabaseSync,
  session: AuthSession,
  quoteId: string,
): ObservationComparisonRow[] | undefined {
  const quote = requireOwnedQuote(db, session, quoteId);
  const observation = quotesRepo.getQuoteAiObservation(db, session.businessId, quoteId);
  if (!observation) return undefined;
  return compareObservationToCharacteristics(observation, quote.analysis.characteristics);
}

export interface QuoteWithOutcomeSummary {
  quote: Quote;
  outcome: JobOutcome | undefined;
  /** Whether AI analysis was used to produce this quote's characteristics at all. */
  aiUsed: boolean;
  /** Whether the AI's observation was manually corrected — `undefined` (not just `false`) when AI wasn't used, since "not determinable" and "nothing was corrected" are different facts. */
  aiCorrected: boolean | undefined;
}

/**
 * Every one of this business's quotes, annotated with its recorded outcome
 * (if any) and whether/how AI was involved — the data the job-outcomes list
 * view needs. Deliberately lists ALL quotes, not just ones with a recorded
 * outcome: the point of the view is to show what still needs recording,
 * not only what's already done.
 */
export function listQuotesWithOutcomes(db: DatabaseSync, session: AuthSession): QuoteWithOutcomeSummary[] {
  const quotes = quotesRepo.listQuotes(db, session.businessId);
  const outcomes = new Map(
    jobOutcomesRepo.listJobOutcomesForBusiness(db, session.businessId).map((outcome) => [outcome.quoteId, outcome]),
  );
  const observations = quotesRepo.listAiObservationsByQuoteId(db, session.businessId);

  return quotes.map((quote) => {
    const observation = observations.get(quote.id);
    return {
      quote,
      outcome: outcomes.get(quote.id),
      aiUsed: observation !== undefined,
      aiCorrected: observation ? wasObservationCorrected(observation, quote.analysis.characteristics) : undefined,
    };
  });
}
