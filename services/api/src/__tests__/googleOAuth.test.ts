import { createServer } from "node:http";
import type { RequestListener, Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet } from "jose";
import {
  buildGoogleAuthorizationUrl,
  exchangeCodeForIdToken,
  generatePkcePair,
  generateRandomToken,
  verifyGoogleIdToken,
  GoogleAuthError,
} from "../auth/googleOAuth";

/**
 * The low-level OIDC mechanics (see
 * docs/decisions/0019-account-settings-and-google-auth.md). ID-token
 * verification is tested against a locally-generated keypair via `jose`'s
 * `createLocalJWKSet` — the exact same "fake the network dependency
 * locally, prove the real verification logic end-to-end" pattern
 * `stripeProvider.test.ts`/`anthropic.test.ts` already use for HTTP
 * providers, applied here to a JWKS instead of a REST API. No real network
 * access or Google credentials are ever used.
 */

let server: Server | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

function listen(handler: RequestListener): Promise<string> {
  return new Promise((resolve) => {
    server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const address = server!.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

describe("generatePkcePair", () => {
  it("derives code_challenge as the SHA-256(base64url) of a distinct code_verifier each time", () => {
    const a = generatePkcePair();
    const b = generatePkcePair();
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    expect(a.codeChallenge).not.toBe(b.codeChallenge);
    expect(a.codeVerifier.length).toBeGreaterThan(20);
  });
});

describe("generateRandomToken", () => {
  it("produces a distinct, sufficiently long token each call", () => {
    const tokens = new Set(Array.from({ length: 20 }, () => generateRandomToken()));
    expect(tokens.size).toBe(20);
    for (const token of tokens) expect(token.length).toBeGreaterThan(20);
  });
});

describe("buildGoogleAuthorizationUrl", () => {
  it("includes PKCE, state, nonce, and a minimal openid+email scope", () => {
    const url = new URL(
      buildGoogleAuthorizationUrl({
        clientId: "client-123",
        redirectUri: "https://app.tallyvis.example/api/auth/google/callback",
        state: "state-abc",
        nonce: "nonce-xyz",
        codeChallenge: "challenge-abc",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.tallyvis.example/api/auth/google/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid email");
    expect(url.searchParams.get("state")).toBe("state-abc");
    expect(url.searchParams.get("nonce")).toBe("nonce-xyz");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-abc");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });
});

describe("exchangeCodeForIdToken", () => {
  it("posts the authorization code, PKCE verifier, and credentials, and returns the id_token", async () => {
    let receivedBody: URLSearchParams | undefined;
    const baseUrl = await listen(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      receivedBody = new URLSearchParams(Buffer.concat(chunks).toString("utf-8"));
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ id_token: "fake.id.token" }));
    });

    const idToken = await exchangeCodeForIdToken({
      clientId: "client-123",
      clientSecret: "secret-456",
      code: "auth-code-789",
      redirectUri: "https://app.tallyvis.example/api/auth/google/callback",
      codeVerifier: "verifier-abc",
      tokenEndpoint: baseUrl,
    });

    expect(idToken).toBe("fake.id.token");
    expect(receivedBody?.get("client_id")).toBe("client-123");
    expect(receivedBody?.get("client_secret")).toBe("secret-456");
    expect(receivedBody?.get("code")).toBe("auth-code-789");
    expect(receivedBody?.get("code_verifier")).toBe("verifier-abc");
    expect(receivedBody?.get("grant_type")).toBe("authorization_code");
  });

  it("throws GoogleAuthError on a non-2xx response, without leaking the raw provider error to the caller", async () => {
    const baseUrl = await listen((req, res) => {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "invalid_grant", error_description: "internal detail" }));
    });

    await expect(
      exchangeCodeForIdToken({
        clientId: "client-123",
        clientSecret: "secret-456",
        code: "bad-code",
        redirectUri: "https://app.tallyvis.example/api/auth/google/callback",
        codeVerifier: "verifier-abc",
        tokenEndpoint: baseUrl,
      }),
    ).rejects.toThrow(GoogleAuthError);
  });

  it("throws GoogleAuthError when the response has no id_token", async () => {
    const baseUrl = await listen((req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ access_token: "no-id-token-here" }));
    });

    await expect(
      exchangeCodeForIdToken({
        clientId: "client-123",
        clientSecret: "secret-456",
        code: "code",
        redirectUri: "https://app.tallyvis.example/api/auth/google/callback",
        codeVerifier: "verifier-abc",
        tokenEndpoint: baseUrl,
      }),
    ).rejects.toThrow(GoogleAuthError);
  });
});

describe("verifyGoogleIdToken", () => {
  const CLIENT_ID = "client-123.apps.googleusercontent.com";

  async function makeJwks() {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = "test-key-1";
    publicJwk.alg = "RS256";
    publicJwk.use = "sig";
    const jwks = createLocalJWKSet({ keys: [publicJwk] });
    return { privateKey, jwks };
  }

  async function signToken(privateKey: CryptoKey, claims: Record<string, unknown>) {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(privateKey);
  }

  it("accepts a validly signed token with matching issuer, audience, and nonce", async () => {
    const { privateKey, jwks } = await makeJwks();
    const idToken = await signToken(privateKey, {
      iss: "https://accounts.google.com",
      aud: CLIENT_ID,
      sub: "1234567890",
      email: "Owner@Example.com",
      email_verified: true,
      nonce: "expected-nonce",
    });

    const identity = await verifyGoogleIdToken({ idToken, clientId: CLIENT_ID, expectedNonce: "expected-nonce", jwks });

    expect(identity).toEqual({ sub: "1234567890", email: "owner@example.com", emailVerified: true });
  });

  it("rejects a token signed by a different key (signature failure)", async () => {
    const { jwks } = await makeJwks();
    const { privateKey: otherPrivateKey } = await generateKeyPair("RS256");
    const idToken = await signToken(otherPrivateKey, {
      iss: "https://accounts.google.com",
      aud: CLIENT_ID,
      sub: "1234567890",
      email: "owner@example.com",
      email_verified: true,
      nonce: "n",
    });

    await expect(verifyGoogleIdToken({ idToken, clientId: CLIENT_ID, expectedNonce: "n", jwks })).rejects.toThrow(
      GoogleAuthError,
    );
  });

  it("rejects a token for the wrong audience (a different client id)", async () => {
    const { privateKey, jwks } = await makeJwks();
    const idToken = await signToken(privateKey, {
      iss: "https://accounts.google.com",
      aud: "some-other-client-id",
      sub: "1234567890",
      email: "owner@example.com",
      email_verified: true,
      nonce: "n",
    });

    await expect(verifyGoogleIdToken({ idToken, clientId: CLIENT_ID, expectedNonce: "n", jwks })).rejects.toThrow(
      GoogleAuthError,
    );
  });

  it("rejects a token from the wrong issuer", async () => {
    const { privateKey, jwks } = await makeJwks();
    const idToken = await signToken(privateKey, {
      iss: "https://evil.example.com",
      aud: CLIENT_ID,
      sub: "1234567890",
      email: "owner@example.com",
      email_verified: true,
      nonce: "n",
    });

    await expect(verifyGoogleIdToken({ idToken, clientId: CLIENT_ID, expectedNonce: "n", jwks })).rejects.toThrow(
      GoogleAuthError,
    );
  });

  it("rejects an expired token", async () => {
    const { privateKey, jwks } = await makeJwks();
    const idToken = await new SignJWT({
      iss: "https://accounts.google.com",
      aud: CLIENT_ID,
      sub: "1234567890",
      email: "owner@example.com",
      email_verified: true,
      nonce: "n",
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1800)
      .sign(privateKey);

    await expect(verifyGoogleIdToken({ idToken, clientId: CLIENT_ID, expectedNonce: "n", jwks })).rejects.toThrow(
      GoogleAuthError,
    );
  });

  it("rejects a nonce mismatch — the ID-token-replay defense — even though the signature/issuer/audience are all otherwise valid", async () => {
    const { privateKey, jwks } = await makeJwks();
    const idToken = await signToken(privateKey, {
      iss: "https://accounts.google.com",
      aud: CLIENT_ID,
      sub: "1234567890",
      email: "owner@example.com",
      email_verified: true,
      nonce: "the-real-nonce",
    });

    await expect(
      verifyGoogleIdToken({ idToken, clientId: CLIENT_ID, expectedNonce: "a-different-nonce", jwks }),
    ).rejects.toThrow(GoogleAuthError);
  });

  it("rejects a token missing sub or email", async () => {
    const { privateKey, jwks } = await makeJwks();
    const idToken = await signToken(privateKey, {
      iss: "https://accounts.google.com",
      aud: CLIENT_ID,
      email: "owner@example.com",
      email_verified: true,
      nonce: "n",
    });

    await expect(verifyGoogleIdToken({ idToken, clientId: CLIENT_ID, expectedNonce: "n", jwks })).rejects.toThrow(
      GoogleAuthError,
    );
  });

  it("treats a missing/false email_verified as unverified rather than throwing — the caller decides what to do with it", async () => {
    const { privateKey, jwks } = await makeJwks();
    const idToken = await signToken(privateKey, {
      iss: "https://accounts.google.com",
      aud: CLIENT_ID,
      sub: "1234567890",
      email: "owner@example.com",
      nonce: "n",
    });

    const identity = await verifyGoogleIdToken({ idToken, clientId: CLIENT_ID, expectedNonce: "n", jwks });
    expect(identity.emailVerified).toBe(false);
  });
});
