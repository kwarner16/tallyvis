import { randomBytes, createHash } from "node:crypto";
import { jwtVerify, createRemoteJWKSet, type JWTVerifyGetKey } from "jose";

/**
 * V1 account/product features phase (see
 * docs/decisions/0019-account-settings-and-google-auth.md). Google's
 * standard OAuth 2.0 / OIDC authorization-code flow with PKCE — no
 * hand-rolled cryptography: signature verification against Google's own
 * published JWKS is delegated entirely to `jose` (a well-established,
 * zero-dependency JOSE/JWT library), never implemented by hand here.
 *
 * This module only builds URLs, exchanges the authorization code, and
 * verifies the resulting ID token — it has no opinion about sessions,
 * accounts, or linking policy (see `services/googleAuth.ts` for that).
 */

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export class GoogleAuthError extends Error {}

function base64url(input: Buffer): string {
  return input.toString("base64url");
}

/** A fresh, unguessable value per attempt — used for both `state` (CSRF protection) and `nonce` (ID-token replay protection), which have different purposes but the same entropy requirement. */
export function generateRandomToken(): string {
  return base64url(randomBytes(32));
}

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
}

/** RFC 7636 PKCE — `code_challenge` is the SHA-256 of `code_verifier`, base64url-encoded (S256 method, the only one worth using; "plain" defeats the point). */
export function generatePkcePair(): PkcePair {
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(createHash("sha256").update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

export interface BuildAuthorizationUrlInput {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
}

/** The URL to redirect the browser to — `scope` is deliberately minimal (openid + email only; no profile/name, which this app has no use for and which would otherwise be trusted, unverified client-suppliable data if taken from anywhere other than the verified ID token itself). */
export function buildGoogleAuthorizationUrl(input: BuildAuthorizationUrlInput): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: "openid email",
    state: input.state,
    nonce: input.nonce,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    // Always show the account chooser rather than silently reusing
    // whichever Google session happens to be active in the browser —
    // deliberate, small UX safety margin for a shared/public computer.
    prompt: "select_account",
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

export interface ExchangeCodeInput {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  /** Overridable for tests only — defaults to Google's real token endpoint. */
  tokenEndpoint?: string;
}

/** Exchanges an authorization code for tokens — the PKCE `code_verifier` is what proves this exchange is happening from the same client that started the flow (see RFC 7636), independent of and in addition to `client_secret`. Returns the raw ID token JWT string; verification is a separate step (`verifyGoogleIdToken`), never skipped. */
export async function exchangeCodeForIdToken(input: ExchangeCodeInput): Promise<string> {
  const endpoint = input.tokenEndpoint ?? GOOGLE_TOKEN_ENDPOINT;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: input.clientId,
        client_secret: input.clientSecret,
        code: input.code,
        redirect_uri: input.redirectUri,
        grant_type: "authorization_code",
        code_verifier: input.codeVerifier,
      }).toString(),
    });
  } catch {
    throw new GoogleAuthError("Could not reach Google to complete sign-in.");
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error(`Google token exchange failed (status ${response.status}): ${body}`);
    throw new GoogleAuthError("Google rejected the sign-in attempt. Please try again.");
  }

  const body = (await response.json()) as { id_token?: string };
  if (!body.id_token) {
    throw new GoogleAuthError("Google did not return an identity token.");
  }
  return body.id_token;
}

export interface VerifyIdTokenInput {
  idToken: string;
  clientId: string;
  expectedNonce: string;
  /** Overridable for tests only — a `jose` key resolver standing in for Google's real remote JWKS, so the full verification path (signature, issuer, audience, expiry, nonce) can be tested against a locally-signed token with no network access. */
  jwks?: JWTVerifyGetKey;
}

export interface VerifiedGoogleIdentity {
  /** Google's stable subject identifier — THE identity key, permanent and never reused for a different account. Never the email. */
  sub: string;
  email: string;
  emailVerified: boolean;
}

let cachedRemoteJwks: JWTVerifyGetKey | undefined;
function defaultJwks(): JWTVerifyGetKey {
  cachedRemoteJwks ??= createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  return cachedRemoteJwks;
}

/**
 * Verifies a Google ID token per OIDC's core requirements — signature
 * (against Google's published JWKS, via `jose`, never hand-verified),
 * issuer, audience (our own client id — never trust a token issued for a
 * DIFFERENT client), expiry (checked by `jose` itself from `exp`), and
 * nonce (must match the value this same server generated and stored
 * before redirecting to Google — the ID-token-replay defense). Throws
 * `GoogleAuthError` on ANY failure — a caller must never proceed past a
 * failed verification for any reason.
 */
export async function verifyGoogleIdToken(input: VerifyIdTokenInput): Promise<VerifiedGoogleIdentity> {
  const jwks = input.jwks ?? defaultJwks();

  let payload: Record<string, unknown>;
  try {
    const result = await jwtVerify(input.idToken, jwks, {
      issuer: GOOGLE_ISSUERS,
      audience: input.clientId,
    });
    payload = result.payload;
  } catch (err) {
    console.error("Google ID token verification failed:", err);
    throw new GoogleAuthError("Could not verify your Google identity. Please try again.");
  }

  if (payload.nonce !== input.expectedNonce) {
    throw new GoogleAuthError("This sign-in attempt could not be verified (nonce mismatch). Please try again.");
  }

  const sub = payload.sub;
  const email = payload.email;
  if (typeof sub !== "string" || !sub || typeof email !== "string" || !email) {
    throw new GoogleAuthError("Google did not provide the information needed to sign you in.");
  }

  return { sub, email: email.toLowerCase(), emailVerified: payload.email_verified === true };
}
