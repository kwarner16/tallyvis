import type { DatabaseSync } from "node:sqlite";
import { makeId } from "../db/ids";

interface ShareTokenRow {
  id: string;
  quote_id: string;
  business_id: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}

export interface ShareTokenRecord {
  id: string;
  quoteId: string;
  businessId: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
}

function toRecord(row: ShareTokenRow): ShareTokenRecord {
  return {
    id: row.id,
    quoteId: row.quote_id,
    businessId: row.business_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at ?? undefined,
  };
}

export interface InsertShareTokenInput {
  quoteId: string;
  businessId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
}

/** The raw token itself never reaches this file — only its hash. Every query below is scoped by `businessId`, except `resolveActiveShareToken`, where the hash itself is the authorization. */

export function insertShareToken(db: DatabaseSync, input: InsertShareTokenInput): ShareTokenRecord {
  const id = makeId("quote-share");
  db.prepare(
    `INSERT INTO quote_share_tokens (id, quote_id, business_id, token_hash, created_at, expires_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`,
  ).run(id, input.quoteId, input.businessId, input.tokenHash, input.createdAt, input.expiresAt);
  return {
    id,
    quoteId: input.quoteId,
    businessId: input.businessId,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
  };
}

/** Business-side status check — a business can only see share links for quotes it owns. */
export function getActiveShareToken(
  db: DatabaseSync,
  businessId: string,
  quoteId: string,
): ShareTokenRecord | undefined {
  const row = db
    .prepare(
      `SELECT * FROM quote_share_tokens
       WHERE quote_id = ? AND business_id = ? AND revoked_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(quoteId, businessId) as ShareTokenRow | undefined;
  return row ? toRecord(row) : undefined;
}

/** Returns true if a row was actually revoked — false if the business had no active link for this quote (never silently a no-op that looks like success). */
export function revokeActiveShareToken(db: DatabaseSync, businessId: string, quoteId: string): boolean {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE quote_share_tokens SET revoked_at = ?
       WHERE quote_id = ? AND business_id = ? AND revoked_at IS NULL`,
    )
    .run(now, quoteId, businessId);
  return result.changes > 0;
}

/**
 * Resolves a token's hash back to the quote/business it grants access to —
 * or `undefined` if the hash is unknown, was revoked, or has expired.
 * Deliberately NOT scoped by a caller-supplied businessId: the hash itself
 * is the entire credential here, the public equivalent of
 * `auth/session.ts`'s `validateSession`.
 */
export function resolveActiveShareToken(
  db: DatabaseSync,
  tokenHash: string,
): { quoteId: string; businessId: string } | undefined {
  const row = db
    .prepare(
      `SELECT quote_id, business_id, expires_at FROM quote_share_tokens
       WHERE token_hash = ? AND revoked_at IS NULL`,
    )
    .get(tokenHash) as { quote_id: string; business_id: string; expires_at: string } | undefined;
  if (!row) return undefined;
  if (new Date(row.expires_at).getTime() < Date.now()) return undefined;
  return { quoteId: row.quote_id, businessId: row.business_id };
}
