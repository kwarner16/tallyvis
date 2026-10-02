// Redeploy marker (2026-10, Stripe live-mode cutover): a prior empty commit
// didn't force a rebuild — Vercel's ignore-build-step correctly skips a
// commit that touches no files under this project. This comment is a
// real, harmless, zero-behavior-change file touch so a genuine new build
// actually happens and picks up the Stripe Production env vars.
export const MARKETING_URL = process.env.NEXT_PUBLIC_MARKETING_URL ?? "http://localhost:3000";
export const CONTACT_URL = `${MARKETING_URL}/contact`;
/** Reused by the public estimator's SMS consent disclosure (see docs/decisions/0029-sms-consent-and-a2p-10dlc.md) — links to apps/web's existing legal pages rather than duplicating them here. */
export const PRIVACY_URL = `${MARKETING_URL}/privacy`;
export const TERMS_URL = `${MARKETING_URL}/terms`;
/** The customer-facing estimator installation guide (pre-launch audit, 2026-10 — see docs/decisions/0033-pre-launch-audit.md). Linked from the dashboard's "Website → Install Tallyvis" page, same cross-app pattern as PRIVACY_URL/TERMS_URL above. */
export const INSTALL_GUIDE_URL = `${MARKETING_URL}/install`;

/** This app's own absolute URL — needed to build a customer-facing share link that resolves correctly for a visitor on a different device/browser, not just a relative path. Same env var/default apps/web's urls.ts uses for the same purpose in reverse. */
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";

/** The one place a share token turns into the URL a business copies and a customer opens — see docs/decisions/0012-secure-quote-sharing.md. */
export function buildQuoteShareUrl(token: string): string {
  return `${APP_URL}/quote/${token}`;
}

/**
 * The new-quote SMS alert's "Review" link (see
 * docs/decisions/0028-mobile-sms-embed-and-growth-updates.md) — a plain
 * authenticated dashboard route, never a bearer token. Opening it while
 * logged out goes through normal sign-in, which carries this exact path
 * back via `redirect=` (see `middleware.ts` and `authActions.ts`'s
 * `logInAction`).
 */
export function buildQuoteDashboardUrl(quoteId: string): string {
  return `${APP_URL}/dashboard/quotes/${quoteId}`;
}

/**
 * The internal CEO/admin dashboard's business detail page (see
 * docs/decisions/0035-admin-dashboard.md) — used only by the new-signup
 * admin notification (docs/decisions/0039) so Kyle can jump straight to a
 * freshly created business. A plain authenticated route, never a bearer
 * token, same reasoning as `buildQuoteDashboardUrl`.
 */
export function buildAdminBusinessUrl(businessId: string): string {
  return `${APP_URL}/admin/businesses/${businessId}`;
}
