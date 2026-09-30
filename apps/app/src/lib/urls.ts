export const MARKETING_URL = process.env.NEXT_PUBLIC_MARKETING_URL ?? "http://localhost:3000";
export const CONTACT_URL = `${MARKETING_URL}/contact`;

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
