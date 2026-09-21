/**
 * Small shared constants that don't belong in a "use server" file — a
 * Server Actions file may only export async functions, so this (and
 * anything else non-function) has to live separately. See
 * docs/decisions/0016-onboarding-billing-embed.md.
 */

/** Carries a plan chosen on the marketing site through signup, for the dashboard onboarding prompt to preselect once — set by `signUpAction`, read and cleared by `/dashboard/onboarding`. */
export const INTENDED_PLAN_COOKIE_NAME = "tallyvis_intended_plan";
