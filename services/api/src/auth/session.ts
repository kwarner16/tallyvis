import { randomBytes, createHash } from "node:crypto";
import type { Queryable } from "../db/pg/client";

export const SESSION_COOKIE_NAME = "tallyvis_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface AuthSession {
  userId: string;
  businessId: string;
}

/**
 * Opaque bearer session tokens, not JWTs — the only thing that identifies
 * a session is a high-entropy random value the server also holds a copy
 * of (hashed), so a session can be revoked immediately (just delete the
 * row) rather than waiting out a signed token's expiry. `randomBytes` is
 * Node's standard CSPRNG; nothing here is a custom cryptographic primitive.
 */
function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 of the token, used only as a lookup key — not password hashing. A stolen database row alone is not a usable session credential. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Creates a session for an already-authenticated user and returns the raw token to store in the browser's cookie. The database only ever holds the hash. */
export async function createSession(db: Queryable, userId: string, businessId: string): Promise<string> {
  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

  await db.query(
    `INSERT INTO sessions (token_hash, user_id, business_id, expires_at, created_at) VALUES ($1, $2, $3, $4, $5)`,
    [hashToken(token), userId, businessId, expiresAt.toISOString(), now.toISOString()],
  );

  return token;
}

/**
 * Resolves a raw cookie token back to the session it identifies, or
 * `undefined` if the token is missing, unknown, or expired. This is the
 * authoritative point every server-side data access must go through —
 * never trust a client-supplied userId/businessId directly.
 */
export async function validateSession(db: Queryable, token: string | undefined): Promise<AuthSession | undefined> {
  if (!token) return undefined;

  const result = await db.query<{ user_id: string; business_id: string; expires_at: string }>(
    `SELECT user_id, business_id, expires_at FROM sessions WHERE token_hash = $1`,
    [hashToken(token)],
  );
  const row = result.rows[0];

  if (!row) return undefined;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db.query(`DELETE FROM sessions WHERE token_hash = $1`, [hashToken(token)]);
    return undefined;
  }

  return { userId: row.user_id, businessId: row.business_id };
}

export async function revokeSession(db: Queryable, token: string | undefined): Promise<void> {
  if (!token) return;
  await db.query(`DELETE FROM sessions WHERE token_hash = $1`, [hashToken(token)]);
}

/**
 * Revokes every session belonging to a user — used after a successful
 * password reset (see docs/decisions/0016-onboarding-billing-embed.md): if
 * the account was compromised, whoever reset the password is the only
 * party who should stay signed in anywhere, on any device.
 */
export async function revokeAllSessionsForUser(db: Queryable, userId: string): Promise<void> {
  await db.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
}
