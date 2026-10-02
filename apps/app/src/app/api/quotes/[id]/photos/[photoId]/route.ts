import { NextResponse } from "next/server";
import { getDb, getQuotePhoto } from "@tallyvis/api";
import { getOptionalSession } from "@/lib/session";

/**
 * Production hardening (see docs/decisions/0038-quote-photo-storage.md) —
 * the one route that ever serves a customer's submitted photo bytes. A
 * Route Handler, not a Server Action, because an `<img src>` needs a
 * plain authenticated GET it can issue itself.
 *
 * `getOptionalSession()`, not `requireContext()` — `requireContext()`
 * calls `redirect()`, which is meant for a page render, not a binary
 * image response; an unauthenticated request here should get a 401, not
 * a redirect to `/login` that an `<img>` tag can't follow anyway.
 *
 * `getQuotePhoto` resolves the quote through the same
 * `WHERE business_id = $2` scoping every other dashboard read uses, so a
 * signed-in business that edits this URL's `id`/`photoId` to try another
 * business's quote gets exactly the same 404 as a quote that doesn't
 * exist at all — `null` deliberately doesn't distinguish "not found" from
 * "not yours," so neither this route nor its response can leak which one
 * it was.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; photoId: string }> },
): Promise<NextResponse> {
  const session = await getOptionalSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id, photoId } = await params;
  const photo = await getQuotePhoto(getDb(), session, id, photoId);
  if (!photo) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(photo.data), {
    headers: {
      "Content-Type": photo.contentType,
      // Private — never cached by a shared/CDN cache, only this browser,
      // and only briefly: this is customer-owned data, not a public asset.
      "Cache-Control": "private, max-age=3600",
    },
  });
}
