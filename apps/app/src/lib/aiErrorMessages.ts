import type { AiErrorCategory } from "@tallyvis/api";

/**
 * Phase 12 (docs/decisions/0014-ai-real-world-refinement.md) — turns an
 * `AiProviderError`'s category into a message a business or customer can
 * actually act on ("the AI provider is rate-limiting requests" vs. a bare
 * "something went wrong"). Server Actions can only hand a plain `Error`
 * back across the server/client boundary, so callers pass the category
 * through as the error's own message today (see `describeAiErrorMessage`'s
 * call sites in `quoteActions.ts`/`publicActions.ts`) and look it up here
 * client-side.
 */
const CATEGORY_MESSAGES: Record<AiErrorCategory, string> = {
  "not-configured": "AI analysis isn't configured for this environment yet.",
  authentication: "The AI provider rejected our credentials.",
  "rate-limit": "The AI provider is busy right now — please try again in a moment.",
  billing: "AI analysis is temporarily unavailable. Please try again later or continue without it.",
  overloaded: "The AI provider is temporarily at capacity — please try again in a moment.",
  "model-not-found": "AI analysis isn't configured correctly for this environment yet.",
  timeout: "The AI provider didn't respond in time.",
  connection: "Couldn't reach the AI provider.",
  "provider-error": "The AI provider had a problem analyzing these photos.",
  refusal: "The AI wasn't able to analyze these photos.",
  "malformed-response": "The AI returned an unexpected result.",
  "invalid-response": "The AI's analysis didn't look reliable, so it was discarded.",
  "too-many-images": "Too many photos were sent for analysis.",
  "image-too-large": "One of these photos is too large to analyze.",
  "invalid-image": "One of these files isn't a photo Tallyvis can analyze.",
  unknown: "Something went wrong while analyzing these photos.",
};

/** Reassurance that AI is optional, not a blocker — only true where manual entry is fully supported (the dashboard's "New quote" flow). */
export const AI_UNAVAILABLE_CONTINUE_MANUALLY = "AI analysis unavailable — continue manually.";

export function describeAiErrorCategory(category: AiErrorCategory): string {
  return CATEGORY_MESSAGES[category];
}
