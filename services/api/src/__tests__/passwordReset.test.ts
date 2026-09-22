import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "../db/client";
import { signUp, logIn } from "../services/auth";
import { requestPasswordReset, resetPassword } from "../services/passwordReset";
import { createSession, validateSession } from "../auth/session";

/**
 * Phase 14 — password recovery (see
 * docs/decisions/0016-onboarding-billing-embed.md). `requestPasswordReset`
 * never returns the raw token (by design — no enumeration signal to a
 * caller); tests capture it via the `buildResetUrl` callback, the exact
 * seam a real caller (apps/app) also uses to build the actual link.
 */

async function setUp(email = "owner@sparkle.example") {
  const db = createTestDb();
  const { session } = await signUp(db, {
    businessName: "Sparkle Windows",
    ownerEmail: email,
    password: "correct-horse-battery",
  });
  return { db, session, email };
}

function captureToken(): { buildResetUrl: (token: string) => string; get: () => string } {
  let captured = "";
  return {
    buildResetUrl: (token: string) => {
      captured = token;
      return `https://example.com/reset-password?token=${token}`;
    },
    get: () => captured,
  };
}

describe("requestPasswordReset", () => {
  it("issues a usable single-use token for a real account", async () => {
    const { db, email } = await setUp("token-issue@sparkle.example");
    const capture = captureToken();

    await requestPasswordReset(db, email, capture.buildResetUrl);

    expect(capture.get().length).toBeGreaterThan(20);
  });

  it("resolves the same way (no thrown error, no distinguishing signal) for an email with no account — account enumeration protection", async () => {
    const db = createTestDb();
    const capture = captureToken();

    await expect(requestPasswordReset(db, "nobody@nowhere.example", capture.buildResetUrl)).resolves.toBeUndefined();
    expect(capture.get()).toBe(""); // never generates or sends anything for an unknown account
  });
});

describe("requestPasswordReset — enumeration/reliability hardening", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does NOT reject for a real account even when the email provider itself fails (regression: this used to await the send and propagate its rejection, producing a visibly different outcome — error vs. silent success — than a nonexistent email, a much bigger enumeration signal than timing)", async () => {
    const { db, email } = await setUp("provider-fails@sparkle.example");
    const notifications = await import("../notifications");
    vi.spyOn(notifications, "sendEmail").mockRejectedValue(new Error("provider is down"));

    const capture = captureToken();
    await expect(requestPasswordReset(db, email, capture.buildResetUrl)).resolves.toBeUndefined();
    // The token was still issued — a real reset link works even if this particular delivery attempt fails.
    expect(capture.get().length).toBeGreaterThan(20);
  });

  it("resolves without ever invoking buildResetUrl for a nonexistent email, same as before this change — the equivalent-work fix only adds local, discarded work, it never issues or exposes a usable token for an account that doesn't exist", async () => {
    const db = createTestDb();
    let called = false;

    await requestPasswordReset(db, "still-nobody@nowhere.example", () => {
      called = true;
      return "unused";
    });

    expect(called).toBe(false);
  });
});

describe("requestPasswordReset — throttling", () => {
  it("does not issue a second token for an immediate repeat request for the same email (best-effort, single-process cooldown)", async () => {
    const { db, email } = await setUp("throttle-test@sparkle.example");
    const first = captureToken();
    await requestPasswordReset(db, email, first.buildResetUrl);
    const firstToken = first.get();

    const second = captureToken();
    await requestPasswordReset(db, email, second.buildResetUrl);

    expect(second.get()).toBe(""); // throttled — no new token issued, callback never invoked
    expect(firstToken).not.toBe("");
  });
});

describe("resetPassword — success", () => {
  it("updates the password so the new one logs in and the old one no longer works", async () => {
    const { db, session, email } = await setUp("reset-success@sparkle.example");
    const capture = captureToken();
    await requestPasswordReset(db, email, capture.buildResetUrl);

    await resetPassword(db, capture.get(), "brand-new-password-1");

    await expect(logIn(db, { email, password: "brand-new-password-1" })).resolves.toMatchObject({
      session: { businessId: session.businessId },
    });
    await expect(logIn(db, { email, password: "correct-horse-battery" })).rejects.toThrow(/invalid email or password/i);
  });

  it("revokes every existing session for the user on a successful reset", async () => {
    const { db, session, email } = await setUp("reset-revokes@sparkle.example");
    const otherToken = createSession(db, session.userId, session.businessId);
    expect(validateSession(db, otherToken)).toBeDefined();

    const capture = captureToken();
    await requestPasswordReset(db, email, capture.buildResetUrl);
    await resetPassword(db, capture.get(), "brand-new-password-1");

    expect(validateSession(db, otherToken)).toBeUndefined();
  });
});

describe("resetPassword — token validation", () => {
  it("rejects an unknown/forged token", async () => {
    const db = createTestDb();
    await expect(resetPassword(db, "totally-made-up-token", "brand-new-password-1")).rejects.toThrow(
      /invalid or has expired/,
    );
  });

  it("rejects reusing an already-used token (single-use)", async () => {
    const { db, email } = await setUp("reset-single-use@sparkle.example");
    const capture = captureToken();
    await requestPasswordReset(db, email, capture.buildResetUrl);
    await resetPassword(db, capture.get(), "brand-new-password-1");

    await expect(resetPassword(db, capture.get(), "yet-another-password-2")).rejects.toThrow(
      /invalid or has expired/,
    );
  });

  it("rejects an expired token", async () => {
    const db = createTestDb();
    const { insertPasswordResetToken } = await import("../repositories/passwordResetTokens");
    const { createHash } = await import("node:crypto");
    const { session } = await signUp(db, {
      businessName: "Expired Token Co",
      ownerEmail: "expired-token@sparkle.example",
      password: "correct-horse-battery",
    });

    // Inserted directly via the repository (bypassing `requestPasswordReset`,
    // which always issues a fresh 1-hour-out expiry) so the row can be
    // given an already-past expiry — exactly what `resetPassword` checks.
    const rawToken = "manually-issued-expired-token-for-testing";
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    insertPasswordResetToken(db, session.userId, tokenHash, new Date(Date.now() - 1000).toISOString());

    await expect(resetPassword(db, rawToken, "brand-new-password-1")).rejects.toThrow(/invalid or has expired/);
  });

  it("rejects a new password shorter than the minimum length", async () => {
    const { db, email } = await setUp("reset-short-password@sparkle.example");
    const capture = captureToken();
    await requestPasswordReset(db, email, capture.buildResetUrl);

    await expect(resetPassword(db, capture.get(), "short")).rejects.toThrow(/at least 8 characters/);
  });
});
