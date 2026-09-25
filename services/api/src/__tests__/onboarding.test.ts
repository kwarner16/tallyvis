import { describe, expect, it } from "vitest";
import { useTestDb } from "./testHarness";
import { signUp, logIn, setPassword, getCurrentUser } from "../services/auth";
import { completeOnboarding } from "../services/business";
import { signInWithGoogle } from "../services/googleAuth";
import { getBusinessById } from "../repositories/businesses";

const getDb = useTestDb();

/**
 * Google-signup onboarding gap + Google-only password UX fixes (2026-09).
 * See services/googleAuth.ts's `deriveBusinessName` comment and
 * services/auth.ts's `setPassword` comment for the bugs these close:
 * a brand-new Google signup previously landed straight in the real
 * dashboard with a placeholder business name and no way to add a
 * password, and Settings had no working entry point for a password-less
 * account to acquire one.
 */

describe("password signup — needsOnboarding", () => {
  it("is false from the start — a password signup already collects a real business name upfront", async () => {
    const db = getDb();
    const { session } = await signUp(db, {
      businessName: "Sparkle Windows",
      ownerEmail: "owner@sparkle.example",
      password: "correct-horse-battery",
    });
    const business = await getBusinessById(db, session.businessId);
    expect(business?.needsOnboarding).toBe(false);
  });
});

describe("completeOnboarding", () => {
  async function googleSignup(db: ReturnType<typeof getDb>) {
    const outcome = await signInWithGoogle(db, { sub: "google-sub-1", email: "owner@example.com", emailVerified: true });
    if (outcome.kind !== "signup") throw new Error("unreachable");
    return outcome.session;
  }

  it("sets the real business name and clears needsOnboarding", async () => {
    const db = getDb();
    const session = await googleSignup(db);

    const updated = await completeOnboarding(db, session, { businessName: "Kyle's Window Cleaning" });
    expect(updated.name).toBe("Kyle's Window Cleaning");
    expect(updated.needsOnboarding).toBe(false);
  });

  it("rejects an empty business name", async () => {
    const db = getDb();
    const session = await googleSignup(db);
    await expect(completeOnboarding(db, session, { businessName: "   " })).rejects.toThrow(/business name is required/i);
  });

  it("optionally establishes a password credential in the same action", async () => {
    const db = getDb();
    const session = await googleSignup(db);
    await completeOnboarding(db, session, { businessName: "Kyle's Window Cleaning", password: "a-new-password-123" });

    const user = await getCurrentUser(db, session);
    expect(user.hasPassword).toBe(true);
    // The new password credential actually works for email/password login.
    const loggedIn = await logIn(db, { email: "owner@example.com", password: "a-new-password-123" });
    expect(loggedIn.session.userId).toBe(session.userId);
  });

  it("skipping the password leaves the account Google-only, exactly as before", async () => {
    const db = getDb();
    const session = await googleSignup(db);
    await completeOnboarding(db, session, { businessName: "Kyle's Window Cleaning" });

    const user = await getCurrentUser(db, session);
    expect(user.hasPassword).toBe(false);
  });
});

describe("setPassword — Google-only account acquiring a password credential", () => {
  it("succeeds for an account with no password yet, and the new password works for login", async () => {
    const db = getDb();
    const outcome = await signInWithGoogle(db, { sub: "google-sub-2", email: "nopass@example.com", emailVerified: true });
    if (outcome.kind !== "signup") throw new Error("unreachable");

    await setPassword(db, outcome.session, "brand-new-password-1");
    const user = await getCurrentUser(db, outcome.session);
    expect(user.hasPassword).toBe(true);

    const loggedIn = await logIn(db, { email: "nopass@example.com", password: "brand-new-password-1" });
    expect(loggedIn.session.userId).toBe(outcome.session.userId);
  });

  it("refuses to overwrite an account that already has a password — that must go through the change-password (reset-token) flow instead", async () => {
    const db = getDb();
    const { session } = await signUp(db, {
      businessName: "Sparkle Windows",
      ownerEmail: "owner@sparkle.example",
      password: "correct-horse-battery",
    });

    await expect(setPassword(db, session, "some-other-password")).rejects.toThrow(/already has a password/i);

    // The ORIGINAL password still works — nothing was overwritten.
    const loggedIn = await logIn(db, { email: "owner@sparkle.example", password: "correct-horse-battery" });
    expect(loggedIn.session.userId).toBe(session.userId);
  });

  it("rejects a password shorter than the minimum length", async () => {
    const db = getDb();
    const outcome = await signInWithGoogle(db, { sub: "google-sub-3", email: "short@example.com", emailVerified: true });
    if (outcome.kind !== "signup") throw new Error("unreachable");
    await expect(setPassword(db, outcome.session, "short")).rejects.toThrow(/at least 8 characters/i);
  });
});
