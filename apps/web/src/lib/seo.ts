/**
 * Phase 15 (see docs/decisions/0028-mobile-sms-embed-and-growth-updates.md)
 * — the SEO foundation's one canonical-domain constant, mirroring
 * `urls.ts`'s existing `NEXT_PUBLIC_APP_URL` pattern (env var with a
 * sensible local-dev default). Every absolute URL metadata needs
 * (`metadataBase`, canonical links, the sitemap, JSON-LD `url` fields)
 * reads this — never a second hardcoded domain string.
 */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tallyvis.com";
