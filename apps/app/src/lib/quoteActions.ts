"use server";

import { revalidatePath } from "next/cache";
import type {
  CustomerInput,
  PricingConfiguration,
  Quote,
  QuoteStatus,
  WindowCleaningCharacteristics,
} from "@tallyvis/types";
import {
  analyzePropertyForBusiness,
  createQuote as apiCreateQuote,
  generateShareLink,
  getConfigurationById,
  getShareLinkStatus,
  recalculateQuoteEstimate as apiRecalculateQuoteEstimate,
  revokeShareLink,
  updateQuoteAnalysis as apiUpdateQuoteAnalysis,
  updateQuoteCustomer as apiUpdateQuoteCustomer,
  updateQuoteStatus as apiUpdateQuoteStatus,
  type AnalyzePropertyInput,
  type AnalyzePropertyResult,
  type CreateQuoteInput,
  type ShareLinkStatus,
} from "@tallyvis/api";
import { requireContext } from "./session";
import { buildQuoteShareUrl } from "./urls";

/**
 * Thin server-side wrappers: every one of these re-derives the business
 * from the session cookie via `requireContext()` and hands it straight to
 * `@tallyvis/api`'s service layer — nothing here accepts or trusts a
 * businessId from the caller. Client components call these instead of
 * touching `@tallyvis/api` directly, which they can't anyway (it imports
 * `node:sqlite`, so pulling it into a "use client" file would fail to
 * bundle for the browser).
 */

export async function createQuoteAction(input: CreateQuoteInput): Promise<Quote> {
  const { db, session } = await requireContext();
  const quote = apiCreateQuote(db, session, input);
  revalidatePath("/dashboard/quotes");
  revalidatePath("/dashboard");
  return quote;
}

/**
 * Phase 11 — AI-assisted photo analysis for a business creating a quote
 * itself (see docs/decisions/0013-ai-analysis-foundation.md).
 * `requireContext()` derives the business from the session exactly like
 * every other action in this file; there is no businessId parameter for a
 * caller to substitute. Returns the full `AnalyzePropertyResult`
 * (reconciled characteristics *and* the raw per-field observation), since
 * `NewQuoteClient`'s review step shows the AI's own confidence per field
 * before the business confirms/edits and saves — the public estimator's
 * counterpart (`analyzePublicPropertyAction`) deliberately returns less.
 */
export async function analyzePropertyAction(input: AnalyzePropertyInput): Promise<AnalyzePropertyResult> {
  const { db, session } = await requireContext();
  return analyzePropertyForBusiness(db, session, input);
}

export async function updateQuoteAnalysisAction(
  quoteId: string,
  characteristics: WindowCleaningCharacteristics,
): Promise<Quote> {
  const { db, session } = await requireContext();
  const quote = apiUpdateQuoteAnalysis(db, session, quoteId, characteristics);
  revalidatePath(`/dashboard/quotes/${quoteId}`);
  return quote;
}

/**
 * Returns the pricing configuration alongside the quote — recalculation is
 * the one mutation that changes `quote.pricingConfigId`, so the caller
 * needs the new configuration too, not just the quote, to keep its
 * "priced under version N" display from going stale.
 */
export async function recalculateQuoteEstimateAction(
  quoteId: string,
): Promise<{ quote: Quote; pricingConfiguration: PricingConfiguration | undefined }> {
  const { db, session } = await requireContext();
  const quote = apiRecalculateQuoteEstimate(db, session, quoteId);
  const pricingConfiguration = getConfigurationById(db, session, quote.pricingConfigId);
  revalidatePath(`/dashboard/quotes/${quoteId}`);
  return { quote, pricingConfiguration };
}

export async function updateQuoteCustomerAction(quoteId: string, customer: CustomerInput): Promise<Quote> {
  const { db, session } = await requireContext();
  const quote = apiUpdateQuoteCustomer(db, session, quoteId, customer);
  revalidatePath(`/dashboard/quotes/${quoteId}`);
  return quote;
}

export async function updateQuoteStatusAction(quoteId: string, status: QuoteStatus): Promise<Quote> {
  const { db, session } = await requireContext();
  const quote = apiUpdateQuoteStatus(db, session, quoteId, status);
  revalidatePath(`/dashboard/quotes/${quoteId}`);
  revalidatePath("/dashboard/quotes");
  revalidatePath("/dashboard");
  return quote;
}

/**
 * Business-side quote sharing (Phase 10 — see
 * docs/decisions/0012-secure-quote-sharing.md). `requireContext()` resolves
 * `session.businessId` from the cookie exactly like every other action in
 * this file; `@tallyvis/api`'s share-link functions re-check that the quote
 * actually belongs to that business before touching anything, so a forged
 * quoteId can't reach another business's link.
 */

export interface ShareLinkView extends ShareLinkStatus {
  /** Only ever present immediately after `generateQuoteShareLinkAction` — the raw token is never stored, so it can't be re-derived later. Copy it now. */
  url?: string;
}

export async function getQuoteShareLinkStatusAction(quoteId: string): Promise<ShareLinkView> {
  const { db, session } = await requireContext();
  return getShareLinkStatus(db, session, quoteId);
}

/** Generates (or regenerates, revoking any existing link first) a share link and returns the full customer-facing URL — the one and only time the raw token is available to show/copy. */
export async function generateQuoteShareLinkAction(quoteId: string): Promise<ShareLinkView> {
  const { db, session } = await requireContext();
  const result = generateShareLink(db, session, quoteId);
  revalidatePath(`/dashboard/quotes/${quoteId}`);
  return { active: true, createdAt: result.createdAt, expiresAt: result.expiresAt, url: buildQuoteShareUrl(result.token) };
}

export async function revokeQuoteShareLinkAction(quoteId: string): Promise<void> {
  const { db, session } = await requireContext();
  revokeShareLink(db, session, quoteId);
  revalidatePath(`/dashboard/quotes/${quoteId}`);
}
