import type { DatabaseSync } from "node:sqlite";
import { randomBytes, createHash } from "node:crypto";
import { hashPassword } from "../auth/password";
import { revokeAllSessionsForUser } from "../auth/session";
import { getUserWithPasswordHashByEmail, getUserById, updatePasswordHash } from "../repositories/users";
import {
  getPasswordResetTokenByHash,
  insertPasswordResetToken,
  invalidateActiveTokensForUser,
  markPasswordResetTokenUsed,
} from "../repositories/passwordResetTokens";
import { sendEmail } from "../notifications";

/**
 * Phase 14 — password recovery (see
 * docs/decisions/0016-onboarding-billing-embed.md).
 *
 * Login → Forgot password → enter email → request reset → secure reset
 * link → choose new password → password updated → login.
 *
 * The two functions below are deliberately the entire public surface:
 * `requestPasswordReset` never reveals whether an account exists (same
 * generic outcome either way — the exact non-enumeration guarantee
 * `logIn`'s own comment already documents for wrong-password vs.
 * no-such-user), and `resetPassword` is the only place a token is ever
 * checked or consumed.
 */

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const MIN_PASSWORD_LENGTH = 8;

function generateRawToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Best-effort, single-process throttle on repeated reset requests for the
 * same email — the same documented caveat as
 * `services/aiAnalysis.ts`'s dedup cache: not a distributed rate limiter,
 * just enough to stop a trivial "spam the reset endpoint" loop from
 * flooding the configured email provider in this architecture, which has
 * no separate rate-limiting infrastructure to hook into.
 */
const REQUEST_COOLDOWN_MS = 60 * 1000;
const lastRequestAt = new Map<string, number>();

function isThrottled(email: string): boolean {
  const last = lastRequestAt.get(email);
  return last !== undefined && Date.now() - last < REQUEST_COOLDOWN_MS;
}

/**
 * Always resolves the same way regardless of whether `email` belongs to a
 * real account — never reveals account existence. `buildResetUrl` turns a
 * raw token into the full, absolute link a caller (apps/app) knows how to
 * construct; this function never guesses at a URL scheme itself.
 */
export async function requestPasswordReset(
  db: DatabaseSync,
  email: string,
  buildResetUrl: (rawToken: string) => string,
): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (isThrottled(normalized)) return;
  lastRequestAt.set(normalized, Date.now());

  const record = getUserWithPasswordHashByEmail(db, normalized);
  if (!record) return; // Same silent outcome as "no such account" — no enumeration signal either way.

  invalidateActiveTokensForUser(db, record.user.id);

  const rawToken = generateRawToken();
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();
  insertPasswordResetToken(db, record.user.id, hashToken(rawToken), expiresAt);

  const resetUrl = buildResetUrl(rawToken);
  await sendEmail(
    {
      to: normalized,
      subject: "Reset your Tallyvis password",
      text: `We received a request to reset your Tallyvis password. This link expires in 1 hour and can only be used once:\n\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email — your password hasn't changed.`,
      html: `<p>We received a request to reset your Tallyvis password. This link expires in 1 hour and can only be used once:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you didn't request this, you can safely ignore this email — your password hasn't changed.</p>`,
    },
    "password-reset",
  );
}

/**
 * Resolves a raw token, validates it (unknown/expired/already-used all
 * reject with the same generic message — a token's exact failure reason
 * is never distinguished to the caller), sets the new password, marks the
 * token used, and revokes every existing session for that user. A
 * password reset is a strong enough signal ("I might have lost control of
 * this account") that every other signed-in device should be signed out —
 * only whoever just completed the reset stays authenticated, via a fresh
 * login.
 */
export async function resetPassword(db: DatabaseSync, rawToken: string, newPassword: string): Promise<void> {
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const record = getPasswordResetTokenByHash(db, hashToken(rawToken));
  if (!record || record.usedAt || new Date(record.expiresAt).getTime() < Date.now()) {
    throw new Error("This password reset link is invalid or has expired.");
  }

  const user = getUserById(db, record.userId);
  if (!user) {
    throw new Error("This password reset link is invalid or has expired.");
  }

  const passwordHash = await hashPassword(newPassword);

  db.exec("BEGIN");
  try {
    updatePasswordHash(db, user.id, passwordHash);
    markPasswordResetTokenUsed(db, record.id);
    revokeAllSessionsForUser(db, user.id);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
