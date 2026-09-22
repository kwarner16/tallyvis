"use client";

import { useSearchParams } from "next/navigation";

/**
 * V1 account/product features phase (see
 * docs/decisions/0019-account-settings-and-google-auth.md). Renders the
 * `?error=` query param the Google OAuth callback redirects back with.
 * `GoogleSignInError`/`GoogleAuthError` messages are already written to be
 * safe, generic, user-facing text (never a raw provider/internal error),
 * so they're shown as-is; a handful of route-level codes that never went
 * through those error classes (e.g. a missing `state` cookie) get a
 * friendlier mapped message instead of their internal code.
 */
const KNOWN_CODES: Record<string, string> = {
  google_not_configured: "Google sign-in isn't available right now.",
  google_denied: "Google sign-in was canceled.",
  google_invalid_request: "That Google sign-in attempt couldn't be verified. Please try again.",
  google_sign_in_failed: "Something went wrong signing in with Google. Please try again.",
};

export function GoogleErrorBanner() {
  const error = useSearchParams().get("error");
  if (!error) return null;
  const message = KNOWN_CODES[error] ?? error;
  return (
    <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>
  );
}
