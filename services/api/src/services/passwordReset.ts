import { randomBytes, createHash } from "node:crypto";
import { hashPassword } from "../auth/password";
import { revokeAllSessionsForUser } from "../auth/session";
import type { Queryable } from "../db/pg/client";
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
 *
 * Two enumeration angles, both closed here rather than just documented:
 *
 * 1. TIMING — the found-account path used to `await` the real email send
 *    (a genuine network round-trip, dominant and highly variable once a
 *    real provider like Resend is configured) before returning, while the
 *    not-found path returned near-instantly. Fixed by never awaiting the
 *    send at all: it's fired and left to resolve/reject on its own, with
 *    failures only logged server-side (`.catch` below), never propagated.
 *    The not-found path also now does the same shape of local,
 *    CPU/DB-bound work (generate + hash a token) as the found path,
 *    rather than returning immediately — so the two paths' RESPONSE
 *    TIMES are dominated by the same fast, roughly-equal local operations
 *    on both branches, not by whether a network call happened to be
 *    awaited. This is response-timing normalization via "don't make the
 *    caller wait on the slow part," not an arbitrary sleep — there is no
 *    fixed delay to calibrate or drift out of date as a real provider's
 *    actual latency changes over time.
 * 2. BEHAVIOR ON FAILURE — before this fix, an actual send failure (e.g.
 *    Resend misconfigured, rate-limited, or down) made `sendEmail` reject,
 *    which propagated all the way to the caller — meaning a real account
 *    with a broken email provider produced a visibly different (error)
 *    outcome than a nonexistent email's silent success. That was a much
 *    bigger enumeration signal than timing ever was, and also a plain
 *    reliability bug: the user-facing response was always going to be the
 *    same generic message regardless of delivery outcome, so there was
 *    never a legitimate reason to let a transient provider blip fail the
 *    request. Fixed by the same not-awaited fire-and-log change above.
 *
 * Residual limitation, stated rather than hidden: this normalizes the two
 * paths' OWN response time, but says nothing about correlating separately
 * observable side effects (e.g. an attacker who also has read access to
 * server logs, or who can observe outbound network connections from this
 * process) — out of scope for a response-timing fix.
 *
 * Returns `{ finished }` rather than firing the send truly detached: on
 * Vercel, a serverless function's process can be frozen the moment its
 * response is sent, which does not wait for an unawaited promise to
 * settle — an earlier version of this function did `void sendEmail(...)`
 * with no way for the caller to keep the process alive, and password-reset
 * emails were confirmed in production to never actually leave the process
 * (unlike `sendQuoteEmail`, which `await`s its send and therefore always
 * ran to completion before its own Server Action returned). `finished`
 * lets the caller (`apps/app`'s `requestPasswordResetAction`) register the
 * still-in-flight send with Next.js's `after()`, which Vercel wires to
 * `waitUntil()` — keeping the function alive for the send WITHOUT making
 * the caller (and therefore the browser) wait for it, preserving the exact
 * timing-normalization property above. `services/api` itself never imports
 * `next/server` — that stays `apps/app`'s responsibility per CLAUDE.md's
 * module boundary rules.
 */
export async function requestPasswordReset(
  db: Queryable,
  email: string,
  buildResetUrl: (rawToken: string) => string,
): Promise<{ finished: Promise<void> }> {
  const normalized = email.trim().toLowerCase();
  if (isThrottled(normalized)) return { finished: Promise.resolve() };
  lastRequestAt.set(normalized, Date.now());

  const record = await getUserWithPasswordHashByEmail(db, normalized);

  // Equivalent-shape work on the "no such account" path — generate and
  // hash a real token exactly like the found-account path does, then
  // discard it. Under SQLite this alone was enough (the found-account
  // path's only extra work beyond this was two synchronous, effectively
  // free local writes); under network Postgres, `invalidateActiveTokensForUser`/
  // `insertPasswordResetToken` below are real round trips, so two
  // harmless no-op queries are issued here too — same round-trip COUNT,
  // just never actually touching a row — so the two branches' response
  // TIMES stay close, not just their CPU work. See this function's own
  // module-level comment for why this property is deliberately preserved
  // rather than left to silently regress once the DB call is no longer free.
  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  if (!record) {
    await db.query("SELECT 1");
    await db.query("SELECT 1");
    return { finished: Promise.resolve() }; // Same silent outcome as a real account — no enumeration signal either way.
  }

  await invalidateActiveTokensForUser(db, record.user.id);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();
  await insertPasswordResetToken(db, record.user.id, tokenHash, expiresAt);

  const resetUrl = buildResetUrl(rawToken);
  const finished = sendEmail(
    {
      to: normalized,
      subject: "Reset your Tallyvis password",
      text: `Tallyvis\n\nWe received a request to reset your password. Use the link below within the next hour — it can only be used once:\n\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email. Your password hasn't been changed, and no one can access your account without clicking this exact link.`,
      html: buildPasswordResetHtml(resetUrl),
    },
    "password-reset",
  ).then(
    () => {},
    (err: unknown) => {
      console.error("requestPasswordReset: background email send failed:", err);
    },
  );

  return { finished };
}

/**
 * Part 14 of docs/decisions/0019: a real, polished transactional email —
 * plain inline-styled HTML (no external stylesheet/image loads, standard
 * practice for email clients that strip or block both), Tallyvis-branded,
 * a single clear CTA button, the expiration window, a plain-language
 * explanation of why this is safe, and the standard "didn't request
 * this?" reassurance. `resetUrl` is the only user-relevant secret-bearing
 * value here (the raw token embedded in it) — it appears exactly once,
 * only as the CTA's `href` and the plain-text fallback link, never
 * anywhere else in the message.
 */
function buildPasswordResetHtml(resetUrl: string): string {
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background-color:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f4;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:16px;overflow:hidden;max-width:480px;width:100%;">
        <tr><td style="padding:32px 32px 0 32px;">
          <p style="margin:0;font-size:18px;font-weight:700;color:#18181b;">Tallyvis</p>
        </td></tr>
        <tr><td style="padding:24px 32px 0 32px;">
          <p style="margin:0 0 16px 0;font-size:15px;line-height:1.5;color:#3f3f46;">
            We received a request to reset your Tallyvis password. Click the button below to choose a
            new one — this link expires in <strong>1 hour</strong> and can only be used <strong>once</strong>.
          </p>
        </td></tr>
        <tr><td style="padding:8px 32px 0 32px;" align="left">
          <a href="${resetUrl}" style="display:inline-block;background-color:#2563eb;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 24px;border-radius:8px;">Reset your password</a>
        </td></tr>
        <tr><td style="padding:20px 32px 0 32px;">
          <p style="margin:0;font-size:13px;line-height:1.5;color:#71717a;">
            If the button doesn't work, copy and paste this link into your browser:<br/>
            <a href="${resetUrl}" style="color:#2563eb;word-break:break-all;">${resetUrl}</a>
          </p>
        </td></tr>
        <tr><td style="padding:24px 32px 32px 32px;">
          <p style="margin:0;font-size:13px;line-height:1.5;color:#a1a1aa;">
            Didn&rsquo;t request this? You can safely ignore this email — your password hasn&rsquo;t been
            changed, and no one can access your account without clicking this exact, one-time link.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
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
export async function resetPassword(db: Queryable, rawToken: string, newPassword: string): Promise<void> {
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const record = await getPasswordResetTokenByHash(db, hashToken(rawToken));
  if (!record || record.usedAt || new Date(record.expiresAt).getTime() < Date.now()) {
    throw new Error("This password reset link is invalid or has expired.");
  }

  const user = await getUserById(db, record.userId);
  if (!user) {
    throw new Error("This password reset link is invalid or has expired.");
  }

  const passwordHash = await hashPassword(newPassword);

  await db.transaction(async (tx) => {
    await updatePasswordHash(tx, user.id, passwordHash);
    await markPasswordResetTokenUsed(tx, record.id);
    await revokeAllSessionsForUser(tx, user.id);
  });
}
