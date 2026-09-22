/**
 * Small shared constants that don't belong in a "use server" file — a
 * Server Actions file may only export async functions, so this (and
 * anything else non-function) has to live separately. See
 * docs/decisions/0016-onboarding-billing-embed.md.
 */

/** Carries a plan chosen on the marketing site through signup, for the dashboard onboarding prompt to preselect once — set by `signUpAction`, read and cleared by `/dashboard/onboarding`. */
export const INTENDED_PLAN_COOKIE_NAME = "tallyvis_intended_plan";

/**
 * Google OAuth/OIDC transient cookies — see
 * docs/decisions/0019-account-settings-and-google-auth.md. Set by
 * `/api/auth/google/start`, read and cleared by
 * `/api/auth/google/callback`. Short-lived (long enough for a real human
 * to complete Google's consent screen, never longer) and httpOnly — these
 * never need to be read by client-side JS.
 */
export const GOOGLE_OAUTH_STATE_COOKIE = "tallyvis_google_oauth_state";
export const GOOGLE_OAUTH_NONCE_COOKIE = "tallyvis_google_oauth_nonce";
export const GOOGLE_OAUTH_VERIFIER_COOKIE = "tallyvis_google_oauth_verifier";
export const GOOGLE_OAUTH_COOKIE_MAX_AGE_SECONDS = 10 * 60;
