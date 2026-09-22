import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  getDb,
  exchangeCodeForIdToken,
  verifyGoogleIdToken,
  signInWithGoogle,
  GoogleAuthError,
  GoogleSignInError,
} from "@tallyvis/api";
import { getOptionalSession } from "@/lib/session";
import { setSessionCookie } from "@/lib/authActions";
import { APP_URL } from "@/lib/urls";
import {
  GOOGLE_OAUTH_NONCE_COOKIE,
  GOOGLE_OAUTH_STATE_COOKIE,
  GOOGLE_OAUTH_VERIFIER_COOKIE,
} from "@/lib/constants";

/**
 * V1 account/product features phase (see
 * docs/decisions/0019-account-settings-and-google-auth.md). Completes the
 * flow `/api/auth/google/start` began: validates `state` (CSRF), exchanges
 * the code for an ID token using the PKCE verifier, verifies the ID token
 * (signature/issuer/audience/nonce — see `auth/googleOAuth.ts`), and hands
 * the resulting verified identity to `services/googleAuth.ts` for the
 * actual account-linking decision. This route makes NO linking/signup/
 * login policy decisions itself — it only proves "this really is Google"
 * and then defers entirely to that service.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const store = await cookies();
  const url = new URL(request.url);

  const clearTransientCookies = () => {
    store.delete(GOOGLE_OAUTH_STATE_COOKIE);
    store.delete(GOOGLE_OAUTH_NONCE_COOKIE);
    store.delete(GOOGLE_OAUTH_VERIFIER_COOKIE);
  };

  // A session already present at callback time (independent of anything
  // Google returns) means this was a "Connect Google" attempt from
  // Settings, not a fresh sign-in — the one signal `services/googleAuth.ts`
  // uses to decide whether linking is even on the table. Resolved before
  // touching any Google-supplied data, so it can't be influenced by it.
  const currentSession = await getOptionalSession();
  const errorRedirectTarget = currentSession ? `${APP_URL}/dashboard/settings` : `${APP_URL}/login`;

  if (url.searchParams.get("error")) {
    clearTransientCookies();
    return NextResponse.redirect(`${errorRedirectTarget}?error=google_denied`);
  }

  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const expectedState = store.get(GOOGLE_OAUTH_STATE_COOKIE)?.value;
  const expectedNonce = store.get(GOOGLE_OAUTH_NONCE_COOKIE)?.value;
  const codeVerifier = store.get(GOOGLE_OAUTH_VERIFIER_COOKIE)?.value;
  clearTransientCookies();

  if (!code || !returnedState || !expectedState || !expectedNonce || !codeVerifier || returnedState !== expectedState) {
    // Missing/expired cookies (the attempt took too long, or is a replay
    // of an old callback URL) or a state mismatch (the CSRF case this
    // whole dance exists to catch) — same generic outcome either way.
    return NextResponse.redirect(`${errorRedirectTarget}?error=google_invalid_request`);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${errorRedirectTarget}?error=google_not_configured`);
  }

  try {
    const idToken = await exchangeCodeForIdToken({
      clientId,
      clientSecret,
      code,
      redirectUri: `${APP_URL}/api/auth/google/callback`,
      codeVerifier,
    });

    const identity = await verifyGoogleIdToken({ idToken, clientId, expectedNonce });

    const outcome = await signInWithGoogle(getDb(), identity, currentSession);

    if (outcome.kind === "linked") {
      return NextResponse.redirect(`${APP_URL}/dashboard/settings?linked=google`);
    }

    await setSessionCookie(outcome.token);
    return NextResponse.redirect(`${APP_URL}/dashboard${outcome.kind === "signup" ? "?welcome=google" : ""}`);
  } catch (err) {
    if (err instanceof GoogleSignInError) {
      // Carries a specific, already-safe-to-show message (e.g. "an
      // account already exists for this email") — surfaced via a query
      // param rather than baked into a redirect path, so both /login and
      // /dashboard/settings can render it generically.
      return NextResponse.redirect(`${errorRedirectTarget}?error=${encodeURIComponent(err.message)}`);
    }
    if (err instanceof GoogleAuthError) {
      return NextResponse.redirect(`${errorRedirectTarget}?error=${encodeURIComponent(err.message)}`);
    }
    console.error("Google OAuth callback failed:", err);
    return NextResponse.redirect(`${errorRedirectTarget}?error=google_sign_in_failed`);
  }
}
