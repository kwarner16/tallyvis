"use client";

import { useSearchParams } from "next/navigation";

/** Confirms a just-completed "Connect Google" action — see `/api/auth/google/callback`'s `linked` outcome and docs/decisions/0019-account-settings-and-google-auth.md. */
export function GoogleLinkedBanner() {
  const linked = useSearchParams().get("linked") === "google";
  if (!linked) return null;
  return (
    <p className="rounded-lg border border-accent bg-accent-soft px-3 py-2 text-sm text-accent-strong">
      Your Google account is now connected.
    </p>
  );
}
