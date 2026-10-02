import { NextResponse, type NextRequest } from "next/server";

/**
 * A cheap, edge-safe pre-check only — redirects an obviously-signed-out
 * visitor before a dashboard OR admin page even starts rendering. This is
 * NOT the security boundary: middleware runs in the Edge Runtime, which
 * has no Node builtins (`node:sqlite`, `node:fs`, ...), so it can only
 * check that a session cookie exists, never that it's valid — hence the
 * cookie name is duplicated here as a literal rather than imported from
 * `@tallyvis/api` (importing that package would pull its `node:sqlite`
 * dependency into the edge bundle and fail to build). Must stay in sync
 * with `SESSION_COOKIE_NAME` in services/api/src/auth/session.ts. The
 * real, authoritative check is `requireContext()`
 * (apps/app/src/lib/session.ts), which every dashboard/admin page and
 * Server Action calls to resolve the cookie against the database before
 * touching any business data — see
 * docs/decisions/0011-persistence-auth-and-multi-tenancy.md. For
 * `/admin/*` specifically, `requireAdminContext()`
 * (apps/app/src/lib/adminSession.ts) additionally verifies `is_admin` —
 * this middleware has no way to check that (it can't reach the database),
 * so a signed-in NON-admin still passes this cheap check and is only
 * actually turned back once the real page runs. See
 * docs/decisions/0035-admin-dashboard.md.
 */
const SESSION_COOKIE_NAME = "tallyvis_session";

export function middleware(request: NextRequest) {
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE_NAME);
  if (!hasSessionCookie) {
    const loginUrl = new URL("/login", request.url);
    // Carries the originally-requested dashboard path through login so a
    // deep link (e.g. an SMS "review this quote" link) survives an
    // intervening sign-in instead of dropping the visitor on the generic
    // dashboard home — see logInAction's matching allowlist check, which
    // re-validates this before ever redirecting to it.
    loginUrl.searchParams.set("redirect", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*"],
};
