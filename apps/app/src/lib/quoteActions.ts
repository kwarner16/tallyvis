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
  createQuote as apiCreateQuote,
  getConfigurationById,
  recalculateQuoteEstimate as apiRecalculateQuoteEstimate,
  updateQuoteAnalysis as apiUpdateQuoteAnalysis,
  updateQuoteCustomer as apiUpdateQuoteCustomer,
  updateQuoteStatus as apiUpdateQuoteStatus,
  type CreateQuoteInput,
} from "@tallyvis/api";
import { requireContext } from "./session";

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
