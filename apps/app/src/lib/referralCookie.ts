/**
 * TallyVis Founding Creator Program — the first-party referral
 * attribution cookie (see docs/decisions/0040-creator-affiliate-program.md
 * for the full attribution model). Kept as plain, DOM/Next-free functions
 * — the same "pure logic, injectable" pattern `imageCompression.ts`/
 * `EstimatorContext.tsx`'s embed-id helpers already use — so the
 * encode/decode contract has a direct unit test with no `next/headers`
 * or real cookie jar involved.
 *
 * Set (and read) entirely on `app.tallyvis.com` — never needs a
 * cross-subdomain `Domain=.tallyvis.com` attribute. `tallyvis.com/r/[slug]`
 * (apps/web) only ever redirects straight through to this same app's own
 * `/r/[slug]` (see that route's own comment), which is what actually sets
 * this cookie; by the time a visitor eventually reaches
 * `app.tallyvis.com/signup` — regardless of how many other sites or pages
 * they visit in between — the browser already has it, host-scoped,
 * with nothing cross-domain to coordinate.
 */
export const REFERRAL_COOKIE_NAME = "tv_ref";

/** 30 days — the V1 attribution window (see the ADR's "Attribution" section for why this specific duration was chosen). */
export const REFERRAL_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export interface ReferralCookieValue {
  slug: string;
  /** ISO-8601 — when this cookie was first set (the click), not when it's being read. */
  firstObservedAt: string;
}

/**
 * `slug:firstObservedAt` — deliberately not JSON (avoids any ambiguity
 * about quoting/escaping inside a Cookie header value) and deliberately
 * not an opaque/signed token: the slug is already public (it's the exact
 * URL path segment a creator hands out), so storing it in cleartext here
 * exposes nothing new — see the ADR's "Privacy/Security" section for why
 * this is an accepted, documented tradeoff rather than an oversight.
 */
export function encodeReferralCookieValue(value: ReferralCookieValue): string {
  return `${value.slug}:${value.firstObservedAt}`;
}

/** Returns `undefined` for anything malformed — a missing/corrupted/tampered cookie must never throw, only result in "no attribution signal," the same as no cookie at all. */
export function decodeReferralCookieValue(raw: string | undefined): ReferralCookieValue | undefined {
  if (!raw) return undefined;
  const separatorIndex = raw.indexOf(":");
  if (separatorIndex <= 0) return undefined;
  const slug = raw.slice(0, separatorIndex);
  const firstObservedAt = raw.slice(separatorIndex + 1);
  if (!slug || Number.isNaN(Date.parse(firstObservedAt))) return undefined;
  return { slug, firstObservedAt };
}
