import type { ReactNode } from "react";
import { getCurrentBusiness } from "@tallyvis/api";
import { requireContext } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { GoogleOnboardingModal } from "@/components/dashboard/GoogleOnboardingModal";

/**
 * Every /dashboard/* route is authenticated and business-specific — there
 * is no anonymous, shareable HTML to prerender, ever. Without this, Next's
 * default "auto" rendering mode still ATTEMPTS static generation at build
 * time and only backs off once it hits a Dynamic API (`cookies()`, inside
 * `requireContext()` below); if anything earlier in that same call throws
 * first (e.g. `getDb()` validating DATABASE_URL, if it's ever unset or
 * unreachable during a build), Next treats that as a hard build failure
 * instead of gracefully falling back to dynamic rendering. `force-dynamic`
 * makes Next skip build-time execution of this route tree entirely, so a
 * transient/missing build-time config value here can never break `next
 * build` — this segment config cascades to every nested page under
 * /dashboard (verified: all of them already rendered as dynamic (ƒ) in a
 * working local build, purely from this layout's own `cookies()` call).
 * Cache Components (which removes this option) is not enabled in
 * next.config.ts, so this remains the correct, current Next.js 16 API.
 */
export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const { db, session } = await requireContext();
  const business = await getCurrentBusiness(db, session);

  // Google-signup onboarding gap fix (2026-09) — a brand-new Google
  // signup gets a placeholder business name and no way to set a
  // password (see services/googleAuth.ts's `deriveBusinessName`), with
  // nothing forcing either to be fixed before landing in the real
  // dashboard. Blocking the ENTIRE /dashboard/* tree here (not just
  // `/dashboard` itself) means there's no route a fresh Google signup
  // could navigate straight to and skip this — the same gate every
  // other page under this layout already goes through. Clears once
  // `completeOnboardingAction` succeeds (see GoogleOnboardingModal), and
  // a returning Google user who already completed it never sees this
  // again — `needsOnboarding` defaults to `false` for every other
  // signup path and is only ever set `true` at Google-account creation.
  if (business.needsOnboarding) {
    return <GoogleOnboardingModal initialBusinessName={business.name} />;
  }

  return <DashboardShell businessName={business.name}>{children}</DashboardShell>;
}
