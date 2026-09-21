import type { DatabaseSync } from "node:sqlite";
import { makeId } from "../db/ids";

/**
 * Phase 14 — password recovery (see
 * docs/decisions/0016-onboarding-billing-embed.md). The raw token is never
 * stored — only its SHA-256 hash, the exact pattern `sessions.token_hash`
 * and `quote_share_tokens.token_hash` already established. A row is never
 * deleted after use; `used_at` is set instead, so a replay of an
 * already-used token is still detectable and rejected as "already used,"
 * not "unknown" — useful signal if a token is ever intercepted after the
 * legitimate reset already happened.
 */

interface ResetTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
}

export interface PasswordResetTokenRecord {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
}

function toRecord(row: ResetTokenRow): PasswordResetTokenRecord {
  return {
    id: row.id,
    userId: row.user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    usedAt: row.used_at ?? undefined,
  };
}

export function insertPasswordResetToken(
  db: DatabaseSync,
  userId: string,
  tokenHash: string,
  expiresAt: string,
): PasswordResetTokenRecord {
  const id = makeId("pwreset");
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO password_reset_tokens (id, user_id, token_hash, created_at, expires_at, used_at)
     VALUES (?, ?, ?, ?, ?, NULL)`,
  ).run(id, userId, tokenHash, now, expiresAt);
  return { id, userId, createdAt: now, expiresAt };
}

/** Resolves a token's hash to its record regardless of expiry/used state — the caller decides what those mean; this is a lookup, not an authorization check. */
export function getPasswordResetTokenByHash(
  db: DatabaseSync,
  tokenHash: string,
): PasswordResetTokenRecord | undefined {
  const row = db.prepare(`SELECT * FROM password_reset_tokens WHERE token_hash = ?`).get(tokenHash) as
    | ResetTokenRow
    | undefined;
  return row ? toRecord(row) : undefined;
}

export function markPasswordResetTokenUsed(db: DatabaseSync, id: string): void {
  db.prepare(`UPDATE password_reset_tokens SET used_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
}

/** Invalidates every still-usable token for a user — called before issuing a new one, so at most one reset link is ever live at a time. */
export function invalidateActiveTokensForUser(db: DatabaseSync, userId: string): void {
  db.prepare(`UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL`).run(
    new Date().toISOString(),
    userId,
  );
}
