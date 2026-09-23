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
  AiProviderError,
  analyzePropertyForBusiness,
  createQuote as apiCreateQuote,
  generateShareLink,
  getConfigurationById,
  getShareLinkStatus,
  NotificationError,
  recalculateQuoteEstimate as apiRecalculateQuoteEstimate,
  recordJobOutcome as apiRecordJobOutcome,
  revokeShareLink,
  sendQuoteEmail,
  updateQuoteAnalysis as apiUpdateQuoteAnalysis,
  updateQuoteCustomer as apiUpdateQuoteCustomer,
  updateQuoteStatus as apiUpdateQuoteStatus,
  type AnalyzePropertyInput,
  type AnalyzePropertyResult,
  type CreateQuoteInput,
  type JobOutcome,
  type QuoteEmailResult,
  type SaveJobOutcomeInput,
  type ShareLinkStatus,
} from "@tallyvis/api";
import { requireContext } from "./session";
import { buildQuoteShareUrl } from "./urls";
import { describeNotificationErrorCategory } from "./notificationErrorMessages";
import { describeAiErrorCategory } from "./aiErrorMessages";
import type { ActionResult } from "./actionResult";

/**
 * Thin server-side wrappers: every one of these re-derives the business
 * from the session cookie via `requireContext()` and hands it straight to
 * `@tallyvis/api`'s service layer — nothing here accepts or trusts a
 * businessId from the caller. Client components call these instead of
 * touching `@tallyvis/api` directly, which they can't anyway (it imports
 * `node:sqlite`, so pulling it into a "use client" file would fail to
 * bundle for the browser).
 *
 * Every action returns an `ActionResult` rather than throwing (see
 * actionResult.ts) — a thrown error's real message is stripped in a
 * production build, which every one of these actions used to hit before
 * this fix (React error #441, first found and fixed in the public
 * estimator's publicActions.ts). The underlying `@tallyvis/api` service
 * functions here only ever throw their own hand-written, safe-to-display
 * validation/not-found/state messages (verified against each one's own
 * source — never a raw Postgres/Stripe/Resend/Anthropic error), so
 * `err.message` is trusted directly; a defensive catch-all still exists
 * for anything genuinely unexpected, logged server-side and replaced with
 * a generic message rather than ever reaching the client raw.
 */

function logUnexpected(action: string, err: unknown): void {
  console.error(`[quoteActions] ${action} failed unexpectedly:`, err instanceof Error ? err.message : "non-Error thrown");
}

export async function createQuoteAction(input: CreateQuoteInput): Promise<ActionResult<Quote>> {
  const { db, session } = await requireContext();
  try {
    const quote = await apiCreateQuote(db, session, input);
    revalidatePath("/dashboard/quotes");
    revalidatePath("/dashboard");
    return { ok: true, data: quote };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Could not save this quote." };
  }
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
export async function analyzePropertyAction(input: AnalyzePropertyInput): Promise<ActionResult<AnalyzePropertyResult>> {
  const { db, session } = await requireContext();
  try {
    const result = await analyzePropertyForBusiness(db, session, input);
    return { ok: true, data: result };
  } catch (err) {
    // The category is resolved to its user-facing text here (Phase 12) —
    // never the raw provider error.
    if (err instanceof AiProviderError) return { ok: false, message: describeAiErrorCategory(err.category) };
    logUnexpected("analyzePropertyAction", err);
    return { ok: false, message: describeAiErrorCategory("unknown") };
  }
}

export async function updateQuoteAnalysisAction(
  quoteId: string,
  characteristics: WindowCleaningCharacteristics,
): Promise<ActionResult<Quote>> {
  const { db, session } = await requireContext();
  try {
    const quote = await apiUpdateQuoteAnalysis(db, session, quoteId, characteristics);
    revalidatePath(`/dashboard/quotes/${quoteId}`);
    return { ok: true, data: quote };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Could not save this change." };
  }
}

/**
 * Returns the pricing configuration alongside the quote — recalculation is
 * the one mutation that changes `quote.pricingConfigId`, so the caller
 * needs the new configuration too, not just the quote, to keep its
 * "priced under version N" display from going stale.
 */
export async function recalculateQuoteEstimateAction(
  quoteId: string,
): Promise<ActionResult<{ quote: Quote; pricingConfiguration: PricingConfiguration | undefined }>> {
  const { db, session } = await requireContext();
  try {
    const quote = await apiRecalculateQuoteEstimate(db, session, quoteId);
    const pricingConfiguration = await getConfigurationById(db, session, quote.pricingConfigId);
    revalidatePath(`/dashboard/quotes/${quoteId}`);
    return { ok: true, data: { quote, pricingConfiguration } };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Could not recalculate this quote." };
  }
}

export async function updateQuoteCustomerAction(quoteId: string, customer: CustomerInput): Promise<ActionResult<Quote>> {
  const { db, session } = await requireContext();
  try {
    const quote = await apiUpdateQuoteCustomer(db, session, quoteId, customer);
    revalidatePath(`/dashboard/quotes/${quoteId}`);
    return { ok: true, data: quote };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Could not save this change." };
  }
}

export async function updateQuoteStatusAction(quoteId: string, status: QuoteStatus): Promise<ActionResult<Quote>> {
  const { db, session } = await requireContext();
  try {
    const quote = await apiUpdateQuoteStatus(db, session, quoteId, status);
    revalidatePath(`/dashboard/quotes/${quoteId}`);
    revalidatePath("/dashboard/quotes");
    revalidatePath("/dashboard");
    return { ok: true, data: quote };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Could not update this quote's status." };
  }
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

export async function getQuoteShareLinkStatusAction(quoteId: string): Promise<ActionResult<ShareLinkView>> {
  const { db, session } = await requireContext();
  try {
    const status = await getShareLinkStatus(db, session, quoteId);
    return { ok: true, data: status };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Could not load this quote's customer link." };
  }
}

/** Generates (or regenerates, revoking any existing link first) a share link and returns the full customer-facing URL — the one and only time the raw token is available to show/copy. */
export async function generateQuoteShareLinkAction(quoteId: string): Promise<ActionResult<ShareLinkView>> {
  const { db, session } = await requireContext();
  try {
    const result = await generateShareLink(db, session, quoteId);
    revalidatePath(`/dashboard/quotes/${quoteId}`);
    return {
      ok: true,
      data: { active: true, createdAt: result.createdAt, expiresAt: result.expiresAt, url: buildQuoteShareUrl(result.token) },
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Could not create a customer link." };
  }
}

export async function revokeQuoteShareLinkAction(quoteId: string): Promise<ActionResult<null>> {
  const { db, session } = await requireContext();
  try {
    await revokeShareLink(db, session, quoteId);
    revalidatePath(`/dashboard/quotes/${quoteId}`);
    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Could not revoke this link." };
  }
}

/**
 * Records (or updates) a quote's real-world job outcome (Phase 13 — see
 * docs/decisions/0015-job-outcome-tracking.md). Ownership is re-checked
 * server-side by `recordJobOutcome` itself, exactly like every other
 * mutation in this file — this never touches the quote's own historical
 * `analysis`/`estimate`/`pricingConfigId`.
 */
export async function recordJobOutcomeAction(quoteId: string, input: SaveJobOutcomeInput): Promise<ActionResult<JobOutcome>> {
  const { db, session } = await requireContext();
  try {
    const outcome = await apiRecordJobOutcome(db, session, quoteId, input);
    revalidatePath(`/dashboard/quotes/${quoteId}`);
    revalidatePath("/dashboard/job-outcomes");
    return { ok: true, data: outcome };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Could not save this outcome." };
  }
}

/**
 * Emails the quote to the customer's address on file, using the same
 * secure quote-share token mechanism the "Customer link" panel already
 * uses (Phase 14 — see docs/decisions/0016-onboarding-billing-embed.md).
 * Regenerates the share link as part of sending — any previously copied
 * link becomes invalid, the same behavior "Regenerate" already has.
 */
export async function sendQuoteEmailAction(quoteId: string): Promise<ActionResult<QuoteEmailResult>> {
  const { db, session } = await requireContext();
  try {
    const result = await sendQuoteEmail(db, session, quoteId, buildQuoteShareUrl);
    revalidatePath(`/dashboard/quotes/${quoteId}`);
    return { ok: true, data: result };
  } catch (err) {
    if (err instanceof NotificationError) return { ok: false, message: describeNotificationErrorCategory(err.category) };
    logUnexpected("sendQuoteEmailAction", err);
    return { ok: false, message: "Could not email this quote. Please try again." };
  }
}
