import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDb, resolveEligibleCreatorBySlug, recordReferralClick } from "@tallyvis/api";
import { MARKETING_URL } from "@/lib/urls";
import {
  REFERRAL_COOKIE_NAME,
  REFERRAL_COOKIE_MAX_AGE_SECONDS,
  encodeReferralCookieValue,
  decodeReferralCookieValue,
} from "@/lib/referralCookie";

/**
 * TallyVis Founding Creator Program — the real referral-link handler
 * (see docs/decisions/0040-creator-affiliate-program.md). The PUBLIC
 * referral URL is `tallyvis.com/r/[slug]` (apps/web), which does nothing
 * but redirect straight here — this is where the actual validation,
 * click-recording, and cookie-setting happen, on `app.tallyvis.com`
 * itself (see `referralCookie.ts`'s own comment for why that avoids any
 * cross-domain cookie concern entirely).
 *
 * Every rejection reason — a malformed slug, an unknown slug, a real but
 * currently-inactive creator — is handled IDENTICALLY: redirect onward,
 * set no cookie, show no error. A visitor (or a bot probing for valid
 * codes) can never distinguish "this creator doesn't exist" from "this
 * creator is paused" from "that wasn't a validly-formatted code at all."
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await params;
  const destination = NextResponse.redirect(MARKETING_URL);

  try {
    const store = await cookies();

    // First-click wins: an attribution cookie already present (from this
    // same slug or a different one) is never overwritten — see the ADR's
    // "Attribution" section. Once signup has actually happened, this
    // stops mattering anyway (attributeReferral never fires a second
    // time for the same business), but a visitor who clicks a second
    // creator's link before ever signing up must not silently switch
    // whichever creator the DB will eventually credit.
    if (decodeReferralCookieValue(store.get(REFERRAL_COOKIE_NAME)?.value)) {
      return destination;
    }

    const db = getDb();
    const resolution = await resolveEligibleCreatorBySlug(db, slug);
    if (!resolution) return destination;

    await recordReferralClick(db, resolution.creatorId);

    store.set(REFERRAL_COOKIE_NAME, encodeReferralCookieValue({ slug: resolution.slug, firstObservedAt: new Date().toISOString() }), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: REFERRAL_COOKIE_MAX_AGE_SECONDS,
    });
  } catch (err) {
    // A referral-tracking problem must never turn a marketing link into a
    // broken page for the visitor — log server-side, redirect regardless.
    console.error("[r/slug] referral click handling failed unexpectedly:", err instanceof Error ? err.message : "unknown error");
  }

  return destination;
}
