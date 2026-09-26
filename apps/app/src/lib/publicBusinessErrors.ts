/**
 * Split out from `publicActions.ts` because a `"use server"` file may only
 * export async functions — a plain string constant there breaks the whole
 * module's client-side exports (Next.js's Server Actions compiler treats
 * it as having no valid exports at all, not just the one bad export).
 *
 * Exported verbatim (not just as a category) because a Server Action can
 * only hand a plain `Error`'s `message` back across the client/server
 * boundary — see `analyzePublicPropertyAction`'s own comment on the same
 * limitation for AI errors. Callers compare a caught error's message
 * against this to tell "this embed cannot be resolved at all" (never
 * recoverable by retrying or falling back to manual entry — both need the
 * same lookup to succeed) apart from a transient failure.
 */
export const ESTIMATOR_NOT_CONFIGURED_MESSAGE = "This estimator isn't set up correctly. Contact the business directly.";

/**
 * 2026-09 incident (docs/decisions/0027-direct-estimator-demo-mode.md):
 * the direct, un-embedded `/estimate` wizard (no `embedId` at all — e.g.
 * the marketing site's own "Try the Estimator" button) has no real
 * business relationship with its visitor. It used to silently resolve to
 * an arbitrary real business (`getDefaultPublicBusiness()`, "whichever
 * signed up first") and persist a real quote there — a repeated source of
 * "quote landed on the wrong business" incidents, and dishonest besides
 * (that business never actually received this request in any real
 * sense). The direct wizard now always completes analysis/pricing (using
 * `@tallyvis/config`'s standalone `demoPricingConfiguration` — no real
 * business, no database write) but never persists a quote; this is the
 * message shown instead of a fabricated "saved" confirmation.
 */
export const DEMO_ESTIMATE_NOT_SAVED_MESSAGE =
  "This is a preview of the Tallyvis estimator — no request was sent to a business. Sign up your own business to start receiving real customer requests.";
