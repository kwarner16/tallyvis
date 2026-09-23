import { redirect } from "next/navigation";
import { getOptionalSession } from "@/lib/session";

/**
 * app.tallyvis.com's bare root — not a page anyone's link should normally
 * point at (the marketing site links straight to /estimate for the public
 * wizard, /login and /signup directly, etc.), but it's also the one URL a
 * fresh Vercel deployment naturally opens. Unconditionally redirecting
 * here to /estimate (its behavior from Phase 4, before this app had auth
 * or a dashboard at all) left every other route technically reachable but
 * effectively undiscoverable — the estimator has no link back to login or
 * the dashboard, so opening this app's root gave the impression it was
 * estimator-only. Signed-in visitors belong in their dashboard; signed-out
 * visitors belong at login (with its own link to /signup) — the same
 * "sensible default" every other authenticated SaaS root page uses.
 *
 * Depends on the session cookie (via getOptionalSession, which checks it
 * BEFORE touching the database — see that function's own ordering), so
 * this can never be legitimately static; force-dynamic makes that
 * explicit rather than relying on Next's implicit Dynamic API detection
 * alone (see dashboard/layout.tsx's own comment for why that matters).
 */
export const dynamic = "force-dynamic";

export default async function RootPage() {
  const session = await getOptionalSession();
  redirect(session ? "/dashboard" : "/login");
}
