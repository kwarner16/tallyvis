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
import { sanitizeForPublicDisplay } from "./errorSanitization";
import { ESTIMATOR_NOT_CONFIGURED_MESSAGE, NO_BUSINESS_CONFIGURED_MESSAGE } from "./publicBusinessErrors";
import type { ActionResult } from "./actionResult";

/**
 * Unauthenticated actions for the public `/estimate/*` customer wizard and
 * the `/quote/[token]` customer-facing quote view.
 *
 * Every exported function here returns an `ActionResult<T>` — never
 * throws to the client — because Next.js strips a thrown error's real
 * message in a production build (see `actionResult.ts`'s own
 * comment for how this was confirmed, not assumed). Anything unexpected
 * (a genuine bug, a transient database error) is caught here and logged
 * server-side via `console.error` — safe fields only, matching
 * `@tallyvis/ai`'s own logging convention — then converted to one of the
 * same safe, categorized messages a deliberately-thrown error would have
 * used, never the raw error itself.
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

const GENERIC_FAILURE_MESSAGE = describeAiErrorCategory("unknown");

function logUnexpected(action: string, err: unknown): void {
  // Never the raw error object (could carry request/connection internals) —
  // only its own message, and only server-side.
  console.error(`[publicActions] ${action} failed unexpectedly:`, err instanceof Error ? err.message : "non-Error thrown");
}

async function requirePublicBusiness(embedId?: string): Promise<Business> {
  const business = embedId ? await resolveEmbedBusiness(getDb(), embedId) : await getDefaultPublicBusiness(getDb());
  if (!business) {
    throw new Error(embedId ? ESTIMATOR_NOT_CONFIGURED_MESSAGE : NO_BUSINESS_CONFIGURED_MESSAGE);
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
export async function getPublicBusinessAction(embedId?: string): Promise<ActionResult<PublicBusinessSummary>> {
  try {
    const summary = await resolvePublicBusinessSummary(getDb(), embedId);
    if (!summary) {
      return { ok: false, message: embedId ? ESTIMATOR_NOT_CONFIGURED_MESSAGE : NO_BUSINESS_CONFIGURED_MESSAGE };
    }
    return { ok: true, data: summary };
  } catch (err) {
    logUnexpected("getPublicBusinessAction", err);
    return { ok: false, message: GENERIC_FAILURE_MESSAGE };
  }
}

export async function getPublicActiveConfigurationAction(embedId?: string): Promise<ActionResult<PricingConfiguration>> {
  try {
    const businessId = await requirePublicBusinessId(embedId);
    const configuration = await getActiveConfigurationForBusiness(getDb(), businessId);
    return { ok: true, data: configuration };
  } catch (err) {
    if (err instanceof Error && (err.message === ESTIMATOR_NOT_CONFIGURED_MESSAGE || err.message === NO_BUSINESS_CONFIGURED_MESSAGE)) {
      return { ok: false, message: err.message };
    }
    logUnexpected("getPublicActiveConfigurationAction", err);
    return { ok: false, message: GENERIC_FAILURE_MESSAGE };
  }
}

/** Used by `/embed/[embedId]`'s landing page to verify the id is real BEFORE redirecting into the wizard, so an invalid/typo'd embed snippet fails fast with a clear message instead of silently breaking several steps later. Any unexpected failure resolves to `false` (the same "invalid" UI a genuinely bad id shows) rather than crashing that page. */
export async function verifyEmbedIdAction(embedId: string): Promise<boolean> {
  try {
    return Boolean(await resolveEmbedBusiness(getDb(), embedId));
  } catch (err) {
    logUnexpected("verifyEmbedIdAction", err);
    return false;
  }
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
): Promise<ActionResult<AnalyzePropertyResult>> {
  // Safe, non-secret stage trace for exactly this kind of failure — never
  // the embed id itself, a photo, or any customer data, only presence/
  // counts/categories. Existing @tallyvis/ai logging already covers the AI
  // call itself (provider, model, latency, success); this covers the stage
  // before it, which previously had no visibility at all — the customer-
  // facing "isn't set up correctly" message could mean either "no embed id
  // was ever present" or "one was present but stale," and only this log
  // line can tell the two apart after the fact.
  const approxEncodedBytes = input.images.reduce((sum, image) => sum + image.url.length, 0);
  console.log(
    JSON.stringify({
      at: new Date().toISOString(),
      event: "public-analyze-stage",
      stage: "requested",
      embedIdPresent: Boolean(embedId),
      imageCount: input.images.length,
      approxEncodedBytes,
    }),
  );

  let businessId: string;
  try {
    businessId = await requirePublicBusinessId(embedId);
  } catch (err) {
    console.log(
      JSON.stringify({
        at: new Date().toISOString(),
        event: "public-analyze-stage",
        stage: "business-resolution-failed",
        embedIdPresent: Boolean(embedId),
      }),
    );
    if (err instanceof Error && (err.message === ESTIMATOR_NOT_CONFIGURED_MESSAGE || err.message === NO_BUSINESS_CONFIGURED_MESSAGE)) {
      return { ok: false, message: err.message };
    }
    logUnexpected("analyzePublicPropertyAction (business resolution)", err);
    return { ok: false, message: NO_BUSINESS_CONFIGURED_MESSAGE };
  }

  try {
    const result = await analyzePropertyPublic(getDb(), businessId, input);
    console.log(
      JSON.stringify({ at: new Date().toISOString(), event: "public-analyze-stage", stage: "analysis-succeeded" }),
    );
    return { ok: true, data: result };
  } catch (err) {
    const errorCategory = err instanceof AiProviderError ? err.category : "unknown";
    console.log(
      JSON.stringify({
        at: new Date().toISOString(),
        event: "public-analyze-stage",
        stage: "analysis-failed",
        errorCategory,
      }),
    );
    if (err instanceof AiProviderError) return { ok: false, message: describeAiErrorCategory(err.category) };
    logUnexpected("analyzePublicPropertyAction", err);
    return { ok: false, message: GENERIC_FAILURE_MESSAGE };
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
export async function createPublicQuoteAction(
  input: CreateQuoteInput,
  embedId?: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const businessId = await requirePublicBusinessId(embedId);
    const quote = await createQuotePublic(getDb(), businessId, input);
    return { ok: true, data: { id: quote.id } };
  } catch (err) {
    if (err instanceof Error && (err.message === ESTIMATOR_NOT_CONFIGURED_MESSAGE || err.message === NO_BUSINESS_CONFIGURED_MESSAGE)) {
      return { ok: false, message: err.message };
    }
    // Anything else here is either a real validation error (e.g. the
    // required-service-address check in services/quotes.ts) — safe and
    // meant to be shown verbatim — or genuinely unexpected (a database/
    // infrastructure failure). `sanitizeForPublicDisplay` tells those apart
    // by shape (see errorSanitization.ts) rather than trusting every
    // `err.message` unconditionally.
    logUnexpected("createPublicQuoteAction", err);
    return { ok: false, message: sanitizeForPublicDisplay(err, "Could not save this request. Please try again.") };
  }
}

/**
 * For the customer-facing `/quote/[token]` view (Phase 10 — see
 * docs/decisions/0012-secure-quote-sharing.md). The raw share token IS the
 * authorization: `getQuoteByShareToken` resolves it server-side to exactly
 * one quote and its owning business, or nothing at all. There is no id
 * parameter here for a caller to substitute — only the token. Resolves to
 * `null` for an unknown/revoked/expired token AND for an unexpected
 * failure alike — the page already treats `null` as "we couldn't find
 * this estimate," which is also the safest thing to show for a failure a
 * customer has no way to act on anyway.
 */
export async function getPublicQuoteByTokenAction(token: string): Promise<PublicQuoteView | null> {
  try {
    const result = await getQuoteByShareToken(getDb(), token);
    return result ?? null;
  } catch (err) {
    logUnexpected("getPublicQuoteByTokenAction", err);
    return null;
  }
}

const QUOTE_ACTION_GENERIC_MESSAGES = {
  accept: "Could not accept this quote. Please try again.",
  decline: "Could not decline this quote. Please try again.",
  "request-changes": "Could not send your request. Please try again.",
} as const;

/** Customer action: accept. Operates only on whatever quote `token` resolves to — see `getQuoteByShareToken`'s comment. */
export async function acceptPublicQuoteAction(token: string): Promise<ActionResult<Quote>> {
  try {
    return { ok: true, data: await acceptQuoteByToken(getDb(), token) };
  } catch (err) {
    logUnexpected("acceptPublicQuoteAction", err);
    return { ok: false, message: sanitizeForPublicDisplay(err, QUOTE_ACTION_GENERIC_MESSAGES.accept) };
  }
}

/** Customer action: decline. Same token-only authorization as accept. */
export async function declinePublicQuoteAction(token: string): Promise<ActionResult<Quote>> {
  try {
    return { ok: true, data: await declineQuoteByToken(getDb(), token) };
  } catch (err) {
    logUnexpected("declinePublicQuoteAction", err);
    return { ok: false, message: sanitizeForPublicDisplay(err, QUOTE_ACTION_GENERIC_MESSAGES.decline) };
  }
}

/** Customer action: request changes / contact the business — persisted as a note, not a status change. */
export async function requestPublicQuoteChangesAction(token: string, note: string): Promise<ActionResult<Quote>> {
  try {
    return { ok: true, data: await requestQuoteChangesByToken(getDb(), token, note) };
  } catch (err) {
    logUnexpected("requestPublicQuoteChangesAction", err);
    return { ok: false, message: sanitizeForPublicDisplay(err, QUOTE_ACTION_GENERIC_MESSAGES["request-changes"]) };
  }
}
