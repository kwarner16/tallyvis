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
 * against these to tell "this business/embed cannot be resolved at all"
 * (never recoverable by retrying or falling back to manual entry — both
 * need the same resolution to succeed) apart from a transient failure.
 */
export const ESTIMATOR_NOT_CONFIGURED_MESSAGE = "This estimator isn't set up correctly. Contact the business directly.";
export const NO_BUSINESS_CONFIGURED_MESSAGE = "No business is configured yet.";
