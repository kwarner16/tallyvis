"use server";

import type { Business, PricingConfiguration, Quote } from "@tallyvis/types";
import {
  acceptQuoteByToken,
  AiProviderError,
  analyzePropertyPublic,
  createQuotePublic,
  declineQuoteByToken,
  getActiveConfigurationForBusiness,
  getDb,
  getDefaultPublicBusiness,
  getQuoteByShareToken,
  requestQuoteChangesByToken,
  resolveEmbedBusiness,
  resolvePublicBusinessSummary,
  type AnalyzePropertyInput,
  type AnalyzePropertyResult,
  type CreateQuoteInput,
  type PublicBusinessSummary,
  type PublicQuoteView,
} from "@tallyvis/api";
import { describeAiErrorCategory } from "./aiErrorMessages";

/**
 * Unauthenticated actions for the public `/estimate/*` customer wizard.
 *
 * "Which business" is resolved one of two ways: an `embedId` (Phase 14 —
 * see docs/decisions/0016-onboarding-billing-embed.md), the PUBLIC,
 * opaque identifier a website embed asserts, resolved server-side via
 * `resolveEmbedBusiness` — never trusted as an internal businessId, never
 * used for anything beyond this public lookup; or, when no `embedId` is
 * given (the marketing site's own bare `/estimate/*` wizard, unchanged
 * since Phase 9), `getDefaultPublicBusiness` — see that function's own
 * comment and docs/decisions/0011-persistence-auth-and-multi-tenancy.md
 * for why that particular case remains a stated simplification rather
 * than real multi-business routing.
 */

async function requirePublicBusiness(embedId?: string): Promise<Business> {
  const business = embedId ? await resolveEmbedBusiness(getDb(), embedId) : await getDefaultPublicBusiness(getDb());
  if (!business) {
    throw new Error(embedId ? "This estimator isn't set up correctly. Contact the business directly." : "No business is configured yet.");
  }
  return business;
}

async function requirePublicBusinessId(embedId?: string): Promise<string> {
  return (await requirePublicBusiness(embedId)).id;
}

/**
 * Only what the estimator result page actually renders (business name and
 * branding) — deliberately NOT the full `Business` record `requirePublicBusiness`
 * resolves internally. See `resolvePublicBusinessSummary`'s own comment
 * for the over-exposure bug class this closes (found during the Stripe V1
 * hardening audit, not a reported incident) — the full record includes
 * the owner's login email and internal database id, and because this
 * crosses a client/server boundary (a Server Action called from a client
 * component), those fields were genuinely transmitted to the browser on
 * every page load, not merely present in a server-side object.
 */
export async function getPublicBusinessAction(embedId?: string): Promise<PublicBusinessSummary> {
  const summary = await resolvePublicBusinessSummary(getDb(), embedId);
  if (!summary) {
    throw new Error(embedId ? "This estimator isn't set up correctly. Contact the business directly." : "No business is configured yet.");
  }
  return summary;
}

export async function getPublicActiveConfigurationAction(embedId?: string): Promise<PricingConfiguration> {
  const businessId = await requirePublicBusinessId(embedId);
  return await getActiveConfigurationForBusiness(getDb(), businessId);
}

/** Used by `/embed/[embedId]`'s landing page to verify the id is real BEFORE redirecting into the wizard, so an invalid/typo'd embed snippet fails fast with a clear message instead of silently breaking several steps later. */
export async function verifyEmbedIdAction(embedId: string): Promise<boolean> {
  return Boolean(await resolveEmbedBusiness(getDb(), embedId));
}

/**
 * Phase 11 — the customer estimator's AI analysis step, moved server-side
 * (see docs/decisions/0013-ai-analysis-foundation.md). Previously
 * `/estimate/analyzing` imported `@tallyvis/ai` and called it directly
 * from the browser; that only worked because the Phase 4 mock needs no
 * secret. This is the one and only reachable path from an unauthenticated
 * caller to AI analysis — `/quote/[token]`'s public actions have no
 * equivalent, by design.
 *
 * Returns the full `AnalyzePropertyResult` (reconciled `analysis` *and*
 * the raw per-field `observation`) as of Phase 13 — the public wizard
 * still has no review UI that displays the observation (unchanged from
 * Phase 12's reasoning), but it's now preserved in `EstimatorContext` and
 * saved alongside the resulting quote if the customer completes the
 * request, so it can later be compared against whatever ends up confirmed.
 * See docs/decisions/0015-job-outcome-tracking.md.
 */
export async function analyzePublicPropertyAction(
  input: AnalyzePropertyInput,
  embedId?: string,
): Promise<AnalyzePropertyResult> {
  const businessId = await requirePublicBusinessId(embedId);
  try {
    return await analyzePropertyPublic(getDb(), businessId, input);
  } catch (err) {
    // See analyzePropertyAction's twin in quoteActions.ts — a Server Action
    // can only hand back a plain Error's `message`, so the category's
    // user-facing text is resolved here (Phase 12).
    if (err instanceof AiProviderError) throw new Error(describeAiErrorCategory(err.category));
    throw err;
  }
}

/**
 * Whether AI analysis is currently the Phase 4/11 heuristic mock (the
 * default — see `.env.example`) rather than a real computer-vision
 * provider. Not a secret — `AI_PROVIDER` only ever selects "mock" or
 * "anthropic", never the API key — but it must still be read server-side
 * and handed to the client explicitly rather than assumed, so the
 * "simulated" disclaimer CLAUDE.md requires for mocks stays accurate
 * if/when a business actually configures a real provider.
 */
export async function isUsingMockAiProviderAction(): Promise<boolean> {
  return (process.env.AI_PROVIDER?.trim() || "mock") !== "anthropic";
}

/**
 * Returns only the new quote's id, not the whole `Quote`. The estimator's
 * result page already has everything else it renders in memory, and this is
 * an unauthenticated endpoint anyone can call with any payload — handing
 * back the full persisted record (business id, the customer row, the
 * server-side estimate) would be more than the browser needs and more than
 * an anonymous caller should see.
 */
export async function createPublicQuoteAction(input: CreateQuoteInput, embedId?: string): Promise<{ id: string }> {
  const businessId = await requirePublicBusinessId(embedId);
  const quote = await createQuotePublic(getDb(), businessId, input);
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
  const result = await getQuoteByShareToken(getDb(), token);
  return result ?? null;
}

/** Customer action: accept. Operates only on whatever quote `token` resolves to — see `getQuoteByShareToken`'s comment. */
export async function acceptPublicQuoteAction(token: string): Promise<Quote> {
  return await acceptQuoteByToken(getDb(), token);
}

/** Customer action: decline. Same token-only authorization as accept. */
export async function declinePublicQuoteAction(token: string): Promise<Quote> {
  return await declineQuoteByToken(getDb(), token);
}

/** Customer action: request changes / contact the business — persisted as a note, not a status change. */
export async function requestPublicQuoteChangesAction(token: string, note: string): Promise<Quote> {
  return await requestQuoteChangesByToken(getDb(), token, note);
}
