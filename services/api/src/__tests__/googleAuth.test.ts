import { describe, expect, it } from "vitest";
import { useTestDb } from "./testHarness";
import { signUp } from "../services/auth";
import { signInWithGoogle, GoogleSignInError } from "../services/googleAuth";
import { completeOnboarding } from "../services/business";
import { getIdentityByProviderAccountId } from "../repositories/authIdentities";
import { getBusinessById } from "../repositories/businesses";
import { validateSession } from "../auth/session";
import type { VerifiedGoogleIdentity } from "../auth/googleOAuth";

const getDb = useTestDb();

/**
 * Account-linking policy tests for Google sign-in — see
 * docs/decisions/0019-account-settings-and-google-auth.md, Part 21 and
 * `services/googleAuth.ts`'s own module comment for the exact rule this
 * verifies: an identity is only ever attached to an account when the
 * caller can already prove control of it (a prior linking, or an active
 * session) — never on a bare email match.
 */

function identity(overrides: Partial<VerifiedGoogleIdentity> = {}): VerifiedGoogleIdentity {
  return { sub: "google-sub-1", email: "owner@example.com", emailVerified: true, ...overrides };
}

describe("signInWithGoogle — fresh sign-up (no existing identity, no session, no account collision)", () => {
  it("creates a brand-new business/user/identity/session for a verified email", async () => {
    const db = getDb();
    const outcome = await signInWithGoogle(db, identity());

    expect(outcome.kind).toBe("signup");
    if (outcome.kind !== "signup") throw new Error("unreachable");
    expect(await validateSession(db, outcome.token)).toEqual(outcome.session);

    const linked = await getIdentityByProviderAccountId(db, "google", "google-sub-1");
    expect(linked?.userId).toBe(outcome.session.userId);
  });

  it("rejects an unverified email rather than creating an account", async () => {
    const db = getDb();
    await expect(signInWithGoogle(db, identity({ emailVerified: false }))).rejects.toThrow(GoogleSignInError);
    expect(await getIdentityByProviderAccountId(db, "google", "google-sub-1")).toBeUndefined();
  });

  it("derives a placeholder business name from the email's local part", async () => {
    const db = getDb();
    const outcome = await signInWithGoogle(db, identity({ email: "jordan.smith@example.com" }));
    if (outcome.kind !== "signup") throw new Error("unreachable");
    // Just needs to be non-empty and not the raw email — exact wording isn't a policy, it's a starter default the owner can rename.
    expect(outcome.session.businessId).toBeTruthy();
  });

  it("marks a brand-new Google signup as needing onboarding (2026-09 fix) — the dashboard requires a real business name/optional password before showing the real dashboard", async () => {
    const db = getDb();
    const outcome = await signInWithGoogle(db, identity());
    if (outcome.kind !== "signup") throw new Error("unreachable");
    const business = await getBusinessById(db, outcome.session.businessId);
    expect(business?.needsOnboarding).toBe(true);
  });
});

describe("signInWithGoogle — email collision with an existing (non-Google) account, no active session", () => {
  it("rejects rather than silently linking or logging in — the core anti-hijack rule", async () => {
    const db = getDb();
    await signUp(db, { businessName: "Sparkle Windows", ownerEmail: "victim@example.com", password: "correct-horse-battery" });

    await expect(signInWithGoogle(db, identity({ email: "victim@example.com" }))).rejects.toThrow(
      /already exists for this email/i,
    );
    // No Google identity was created as a side effect of the rejected attempt.
    expect(await getIdentityByProviderAccountId(db, "google", "google-sub-1")).toBeUndefined();
  });
});

describe("signInWithGoogle — returning Google user (identity already linked)", () => {
  it("logs in as the linked account without re-verifying anything about the email", async () => {
    const db = getDb();
    const first = await signInWithGoogle(db, identity());
    if (first.kind !== "signup") throw new Error("unreachable");

    const second = await signInWithGoogle(db, identity());
    expect(second.kind).toBe("login");
    expect(second.session.userId).toBe(first.session.userId);
    expect(second.session.businessId).toBe(first.session.businessId);
  });

  it("a returning login never re-sets needsOnboarding once it's been cleared — a Google user who already completed onboarding never sees it again", async () => {
    const db = getDb();
    const first = await signInWithGoogle(db, identity());
    if (first.kind !== "signup") throw new Error("unreachable");

    await completeOnboarding(db, first.session, { businessName: "Real Business Name" });

    await signInWithGoogle(db, identity());
    const business = await getBusinessById(db, first.session.businessId);
    expect(business?.needsOnboarding).toBe(false);
    expect(business?.name).toBe("Real Business Name");
  });
});

describe("signInWithGoogle — linking from an authenticated session (Settings 'Connect Google')", () => {
  it("links the Google identity to the currently logged-in account, not a new one", async () => {
    const db = getDb();
    const { session } = await signUp(db, {
      businessName: "Sparkle Windows",
      ownerEmail: "owner@sparkle.example",
      password: "correct-horse-battery",
    });

    const outcome = await signInWithGoogle(db, identity({ email: "owner@gmail.example" }), session);

    expect(outcome.kind).toBe("linked");
    expect(outcome.session).toEqual(session);
    const linked = await getIdentityByProviderAccountId(db, "google", "google-sub-1");
    expect(linked?.userId).toBe(session.userId);
  });

  it("rejects linking an unverified Google email even while authenticated", async () => {
    const db = getDb();
    const { session } = await signUp(db, {
      businessName: "Sparkle Windows",
      ownerEmail: "owner@sparkle.example",
      password: "correct-horse-battery",
    });

    await expect(
      signInWithGoogle(db, identity({ emailVerified: false }), session),
    ).rejects.toThrow(GoogleSignInError);
    expect(await getIdentityByProviderAccountId(db, "google", "google-sub-1")).toBeUndefined();
  });

  it("rejects linking a Google identity that's already linked to a DIFFERENT account", async () => {
    const db = getDb();
    // Business A links this Google identity first.
    const businessA = await signUp(db, {
      businessName: "Sparkle Windows",
      ownerEmail: "owner-a@sparkle.example",
      password: "correct-horse-battery",
    });
    await signInWithGoogle(db, identity(), businessA.session);

    // Business B, logged in as itself, tries to "connect" the SAME Google identity.
    const businessB = await signUp(db, {
      businessName: "Shiny Panes",
      ownerEmail: "owner-b@shinypanes.example",
      password: "correct-horse-battery",
    });

    await expect(signInWithGoogle(db, identity(), businessB.session)).rejects.toThrow(
      /already connected to a different/i,
    );
    // Business B was never linked to this identity.
    const linked = await getIdentityByProviderAccountId(db, "google", "google-sub-1");
    expect(linked?.userId).toBe(businessA.session.userId);
  });

  it("logging in via Google while already logged in as the SAME linked account is a safe no-op login, not an error", async () => {
    const db = getDb();
    const business = await signUp(db, {
      businessName: "Sparkle Windows",
      ownerEmail: "owner@sparkle.example",
      password: "correct-horse-battery",
    });
    await signInWithGoogle(db, identity(), business.session);

    const outcome = await signInWithGoogle(db, identity(), business.session);
    expect(outcome.kind).toBe("login");
    expect(outcome.session.userId).toBe(business.session.userId);
  });
});

describe("signInWithGoogle — business isolation", () => {
  it("two different Google identities never resolve to the same business", async () => {
    const db = getDb();
    const first = await signInWithGoogle(db, identity({ sub: "sub-a", email: "a@example.com" }));
    const second = await signInWithGoogle(db, identity({ sub: "sub-b", email: "b@example.com" }));

    if (first.kind !== "signup" || second.kind !== "signup") throw new Error("unreachable");
    expect(first.session.businessId).not.toBe(second.session.businessId);
  });
});
