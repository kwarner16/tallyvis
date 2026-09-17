import type { DatabaseSync } from "node:sqlite";
import { randomBytes, createHash } from "node:crypto";

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
export function createSession(db: DatabaseSync, userId: string, businessId: string): string {
  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

  db.prepare(
    `INSERT INTO sessions (token_hash, user_id, business_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(hashToken(token), userId, businessId, expiresAt.toISOString(), now.toISOString());

  return token;
}

/**
 * Resolves a raw cookie token back to the session it identifies, or
 * `undefined` if the token is missing, unknown, or expired. This is the
 * authoritative point every server-side data access must go through —
 * never trust a client-supplied userId/businessId directly.
 */
export function validateSession(db: DatabaseSync, token: string | undefined): AuthSession | undefined {
  if (!token) return undefined;

  const row = db
    .prepare(`SELECT user_id, business_id, expires_at FROM sessions WHERE token_hash = ?`)
    .get(hashToken(token)) as { user_id: string; business_id: string; expires_at: string } | undefined;

  if (!row) return undefined;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(hashToken(token));
    return undefined;
  }

  return { userId: row.user_id, businessId: row.business_id };
}

export function revokeSession(db: DatabaseSync, token: string | undefined): void {
  if (!token) return;
  db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(hashToken(token));
}
