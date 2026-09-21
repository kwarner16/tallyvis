import type { DatabaseSync } from "node:sqlite";
import { randomBytes, createHash } from "node:crypto";
import type { Business, Quote, QuoteStatus } from "@tallyvis/types";
import { canTransitionQuoteStatus } from "@tallyvis/types";
import type { AuthSession } from "../auth/session";
import { getBusinessById } from "../repositories/businesses";
import * as quotesRepo from "../repositories/quotes";
import * as shareTokensRepo from "../repositories/quoteShareTokens";

/**
 * Secure customer quote sharing (Phase 10) — see
 * docs/decisions/0012-secure-quote-sharing.md. Replaces the Phase 8/9
 * placeholder where a quote's own database id doubled as its public
 * "authorization": that was always documented as a stated limitation
 * (ADR 0010), and this is the real mechanism.
 *
 * The share token is an opaque, high-entropy random value — the exact
 * pattern `auth/session.ts` already established for login sessions. The
 * database never stores the raw token, only its SHA-256 hash, so a leaked
 * database row alone is not a usable link. The raw token is returned from
 * `generateShareLink` exactly once, at creation — there is no way to read
 * an existing link's raw token back out later, by design (see that
 * function's own comment for what this means for the dashboard UI).
 */

const SHARE_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — mirrors a typical quote's validity window.

function generateRawToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A business can only generate/inspect/revoke a share link for a quote it owns — scoped by `session.businessId`, never a client-supplied id. Throws (not "not found" vs. "not yours" — same as every other quote lookup in this package) rather than distinguishing the two to another business. */
function requireOwnedQuote(db: DatabaseSync, session: AuthSession, quoteId: string): Quote {
  const quote = quotesRepo.getQuoteById(db, session.businessId, quoteId);
  if (!quote) throw new Error(`Quote "${quoteId}" not found.`);
  return quote;
}

export interface ShareLinkStatus {
  active: boolean;
  createdAt?: string;
  expiresAt?: string;
}

export interface ShareLinkResult {
  token: string;
  createdAt: string;
  expiresAt: string;
}

/**
 * Business-side: whether an active share link currently exists for this
 * quote, and when it was created/expires — never the raw token itself,
 * since it isn't stored anywhere to read back. The dashboard uses this to
 * decide whether to show "Generate a link" or "Regenerate / Revoke".
 */
export function getShareLinkStatus(db: DatabaseSync, session: AuthSession, quoteId: string): ShareLinkStatus {
  requireOwnedQuote(db, session, quoteId);
  const active = shareTokensRepo.getActiveShareToken(db, session.businessId, quoteId);
  if (!active) return { active: false };
  return { active: true, createdAt: active.createdAt, expiresAt: active.expiresAt };
}

/**
 * Creates a brand-new share link for this quote, revoking any existing
 * active one first — so a quote only ever has at most one working link at
 * a time (also enforced by the database's own partial unique index, the
 * last line of defense if this check is ever bypassed). Returns the raw
 * token; the caller (the dashboard) must show/copy it now, since the
 * database will only ever hold its hash from this point on.
 */
export function generateShareLink(db: DatabaseSync, session: AuthSession, quoteId: string): ShareLinkResult {
  requireOwnedQuote(db, session, quoteId);

  const token = generateRawToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SHARE_TOKEN_TTL_MS);

  db.exec("BEGIN");
  try {
    shareTokensRepo.revokeActiveShareToken(db, session.businessId, quoteId);
    shareTokensRepo.insertShareToken(db, {
      quoteId,
      businessId: session.businessId,
      tokenHash: hashToken(token),
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return { token, createdAt: now.toISOString(), expiresAt: expiresAt.toISOString() };
}

/** Revokes this quote's active share link, if it has one — the link stops working immediately (the next resolution attempt finds no non-revoked row). A no-op, not an error, if there was nothing active to revoke. */
export function revokeShareLink(db: DatabaseSync, session: AuthSession, quoteId: string): void {
  requireOwnedQuote(db, session, quoteId);
  shareTokensRepo.revokeActiveShareToken(db, session.businessId, quoteId);
}

export interface PublicQuoteView {
  quote: Quote;
  business: Business;
  expiresAt: string;
}

/**
 * The public entry point for the customer-facing quote page
 * (`apps/app/src/app/quote/[token]/page.tsx`). The raw token is the ENTIRE
 * authorization credential — nothing about the caller (no id, no business,
 * no session) is trusted beyond it resolving to a non-revoked, unexpired
 * row. Also records that the quote was viewed, so the business can tell
 * whether its customer has looked at it.
 */
export function getQuoteByShareToken(db: DatabaseSync, rawToken: string): PublicQuoteView | undefined {
  const resolved = shareTokensRepo.resolveActiveShareToken(db, hashToken(rawToken));
  if (!resolved) return undefined;

  const business = getBusinessById(db, resolved.businessId);
  if (!business) return undefined;

  quotesRepo.recordQuoteViewed(db, resolved.businessId, resolved.quoteId);
  const quote = quotesRepo.getQuoteById(db, resolved.businessId, resolved.quoteId);
  if (!quote) return undefined;

  const active = shareTokensRepo.getActiveShareToken(db, resolved.businessId, resolved.quoteId);
  return { quote, business, expiresAt: active?.expiresAt ?? "" };
}

/** Resolves a token to its quote, or throws a single generic message that deliberately doesn't distinguish "unknown token" from "revoked" from "expired" from "quote gone" — any of those should look identical to whoever's holding an invalid link. */
function requireTokenQuote(db: DatabaseSync, rawToken: string): { quoteId: string; businessId: string; quote: Quote } {
  const resolved = shareTokensRepo.resolveActiveShareToken(db, hashToken(rawToken));
  if (!resolved) throw new Error("This quote link is invalid or has expired.");
  const quote = quotesRepo.getQuoteById(db, resolved.businessId, resolved.quoteId);
  if (!quote) throw new Error("This quote link is invalid or has expired.");
  return { quoteId: resolved.quoteId, businessId: resolved.businessId, quote };
}

function respondToQuote(
  db: DatabaseSync,
  rawToken: string,
  target: Extract<QuoteStatus, "accepted" | "declined">,
): Quote {
  const { quoteId, businessId, quote } = requireTokenQuote(db, rawToken);
  if (!canTransitionQuoteStatus(quote.status, target)) {
    throw new Error(`This quote can no longer be ${target === "accepted" ? "accepted" : "declined"}.`);
  }
  const updated = quotesRepo.updateQuoteStatus(db, businessId, quoteId, target);
  if (!updated) throw new Error("This quote link is invalid or has expired.");
  return updated;
}

/**
 * Customer action: accept. The token resolves both `quoteId` and
 * `businessId` server-side — there is no id in this function's signature a
 * caller could substitute to act on a different quote. Only reachable from
 * `sent`, the same rule `services/quotes.ts`'s session-scoped
 * `updateQuoteStatus` already enforces via `canTransitionQuoteStatus`.
 */
export function acceptQuoteByToken(db: DatabaseSync, rawToken: string): Quote {
  return respondToQuote(db, rawToken, "accepted");
}

/** Customer action: decline. See `acceptQuoteByToken` — same token-only authorization, same shared transition rule. */
export function declineQuoteByToken(db: DatabaseSync, rawToken: string): Quote {
  return respondToQuote(db, rawToken, "declined");
}

const MAX_REQUEST_NOTE_LENGTH = 2000;

/**
 * Customer action: request changes / contact the business — a persisted
 * note, not a status transition (there's no dedicated status for it; see
 * the ADR for why). Blocked once the quote has reached a terminal status:
 * a decision already made shouldn't be reopened by a stray message landing
 * after the fact.
 */
export function requestQuoteChangesByToken(db: DatabaseSync, rawToken: string, note: string): Quote {
  const { quoteId, businessId, quote } = requireTokenQuote(db, rawToken);
  if (quote.status === "accepted" || quote.status === "declined") {
    throw new Error("This quote has already been finalized and can no longer be changed.");
  }
  const trimmed = note.trim();
  if (trimmed.length === 0) {
    throw new Error("Please describe what you'd like changed.");
  }

  const updated = quotesRepo.recordQuoteChangeRequest(
    db,
    businessId,
    quoteId,
    trimmed.slice(0, MAX_REQUEST_NOTE_LENGTH),
  );
  if (!updated) throw new Error("This quote link is invalid or has expired.");
  return updated;
}
