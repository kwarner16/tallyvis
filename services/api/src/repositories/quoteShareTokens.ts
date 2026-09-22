import { makeId } from "../db/ids";
import type { Queryable } from "../db/pg/client";

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

export async function insertShareToken(db: Queryable, input: InsertShareTokenInput): Promise<ShareTokenRecord> {
  const id = makeId("quote-share");
  await db.query(
    `INSERT INTO quote_share_tokens (id, quote_id, business_id, token_hash, created_at, expires_at, revoked_at)
     VALUES ($1, $2, $3, $4, $5, $6, NULL)`,
    [id, input.quoteId, input.businessId, input.tokenHash, input.createdAt, input.expiresAt],
  );
  return {
    id,
    quoteId: input.quoteId,
    businessId: input.businessId,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
  };
}

/** Business-side status check — a business can only see share links for quotes it owns. */
export async function getActiveShareToken(
  db: Queryable,
  businessId: string,
  quoteId: string,
): Promise<ShareTokenRecord | undefined> {
  const result = await db.query<ShareTokenRow>(
    `SELECT * FROM quote_share_tokens
     WHERE quote_id = $1 AND business_id = $2 AND revoked_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [quoteId, businessId],
  );
  const row = result.rows[0];
  return row ? toRecord(row) : undefined;
}

/** Returns true if a row was actually revoked — false if the business had no active link for this quote (never silently a no-op that looks like success). */
export async function revokeActiveShareToken(db: Queryable, businessId: string, quoteId: string): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await db.query(
    `UPDATE quote_share_tokens SET revoked_at = $1
     WHERE quote_id = $2 AND business_id = $3 AND revoked_at IS NULL`,
    [now, quoteId, businessId],
  );
  return result.rowCount > 0;
}

/**
 * Resolves a token's hash back to the quote/business it grants access to —
 * or `undefined` if the hash is unknown, was revoked, or has expired.
 * Deliberately NOT scoped by a caller-supplied businessId: the hash itself
 * is the entire credential here, the public equivalent of
 * `auth/session.ts`'s `validateSession`.
 */
export async function resolveActiveShareToken(
  db: Queryable,
  tokenHash: string,
): Promise<{ quoteId: string; businessId: string } | undefined> {
  const result = await db.query<{ quote_id: string; business_id: string; expires_at: string }>(
    `SELECT quote_id, business_id, expires_at FROM quote_share_tokens
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [tokenHash],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  if (new Date(row.expires_at).getTime() < Date.now()) return undefined;
  return { quoteId: row.quote_id, businessId: row.business_id };
}
