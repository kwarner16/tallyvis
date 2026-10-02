import { NextResponse } from "next/server";
import { APP_URL } from "@/lib/urls";

/**
 * TallyVis Founding Creator Program — the PUBLIC referral URL a creator
 * shares is `tallyvis.com/r/[slug]` (see
 * docs/decisions/0040-creator-affiliate-program.md). This app has no
 * database and never imports `@tallyvis/api` (see
 * docs/decisions/0002-app-separation.md) — all the real work (validating
 * the creator, recording the click, setting the attribution cookie) is
 * done by apps/app's own `/r/[slug]` route, which this passes straight
 * through to unchanged. Deliberately a plain redirect with no logic of
 * its own, so there is exactly one place (apps/app) that can ever decide
 * whether a slug is real/eligible.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<NextResponse> {
  const { slug } = await params;
  return NextResponse.redirect(`${APP_URL}/r/${encodeURIComponent(slug)}`);
}
