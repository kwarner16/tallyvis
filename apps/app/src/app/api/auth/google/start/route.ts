import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildGoogleAuthorizationUrl, generatePkcePair, generateRandomToken } from "@tallyvis/api";
import { getOptionalSession } from "@/lib/session";
import { APP_URL } from "@/lib/urls";
import {
  GOOGLE_OAUTH_COOKIE_MAX_AGE_SECONDS,
  GOOGLE_OAUTH_NONCE_COOKIE,
  GOOGLE_OAUTH_STATE_COOKIE,
  GOOGLE_OAUTH_VERIFIER_COOKIE,
} from "@/lib/constants";

/**
 * V1 account/product features phase (see
 * docs/decisions/0019-account-settings-and-google-auth.md). Starts
 * Google's standard OAuth 2.0 / OIDC authorization-code flow with PKCE.
 * The exact same route serves three cases — fresh sign-up, returning
 * login, and "Connect Google" from an already-authenticated Settings page
 * — because Google's own flow doesn't distinguish them; the distinction
 * is made later, in `services/googleAuth.ts`, from whether a session
 * cookie happens to already be present when the callback lands.
 *
 * A Route Handler, not a Server Action: this needs to issue an HTTP
 * redirect to a third-party origin, which a Server Action cannot do in
 * response to a plain link/button navigation.
 */
export async function GET(): Promise<NextResponse> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    console.warn("Google OAuth: GOOGLE_CLIENT_ID is not set — redirecting with error=google_not_configured.");
    return NextResponse.redirect(`${APP_URL}/login?error=google_not_configured`);
  }

  // Not required for the redirect itself, but resolving it here (rather
  // than leaving it to the callback) means an expired/invalid session at
  // start-time can't accidentally look like a fresh sign-in once Google's
  // redirect comes back — irrelevant to this route's own behavior, but
  // documents that "logged in or not" is decided once, consistently, from
  // the same cookie read helper used everywhere else in this app.
  await getOptionalSession();

  const state = generateRandomToken();
  const nonce = generateRandomToken();
  const { codeVerifier, codeChallenge } = generatePkcePair();

  const store = await cookies();
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: GOOGLE_OAUTH_COOKIE_MAX_AGE_SECONDS,
  };
  store.set(GOOGLE_OAUTH_STATE_COOKIE, state, cookieOptions);
  store.set(GOOGLE_OAUTH_NONCE_COOKIE, nonce, cookieOptions);
  store.set(GOOGLE_OAUTH_VERIFIER_COOKIE, codeVerifier, cookieOptions);

  const authorizationUrl = buildGoogleAuthorizationUrl({
    clientId,
    redirectUri: `${APP_URL}/api/auth/google/callback`,
    state,
    nonce,
    codeChallenge,
  });

  return NextResponse.redirect(authorizationUrl);
}
