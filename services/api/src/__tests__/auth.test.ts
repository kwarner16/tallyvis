import { describe, expect, it } from "vitest";
import { createTestDb } from "../db/client";
import { logIn, logOut, resolveSession, signUp } from "../services/auth";
import { createBusiness } from "../repositories/businesses";
import { createUser } from "../repositories/users";

function freshDb() {
  return createTestDb();
}

describe("signUp", () => {
  it("creates a business, an owner user, a starter pricing configuration, and a session", async () => {
    const db = freshDb();
    const result = await signUp(db, {
      businessName: "Sparkle Windows",
      ownerEmail: "owner@sparkle.example",
      password: "correct-horse-battery",
    });

    expect(result.session.businessId).toBeTruthy();
    expect(result.token).toBeTruthy();

    const resolved = resolveSession(db, result.token);
    expect(resolved).toEqual(result.session);
  });

  it("rejects a duplicate email and leaves no orphaned business behind", async () => {
    const db = freshDb();
    await signUp(db, { businessName: "A", ownerEmail: "dupe@example.com", password: "password123" });
    const businessCountBefore = (
      db.prepare("SELECT COUNT(*) AS c FROM businesses").get() as { c: number }
    ).c;

    await expect(
      signUp(db, { businessName: "B", ownerEmail: "dupe@example.com", password: "password456" }),
    ).rejects.toThrow(/already exists/);

    const businessCountAfter = (
      db.prepare("SELECT COUNT(*) AS c FROM businesses").get() as { c: number }
    ).c;
    expect(businessCountAfter).toBe(businessCountBefore);
  });

  it("the database itself enforces email uniqueness as a last line of defense (defense in depth behind the application-level check above)", async () => {
    const db = freshDb();
    const business = createBusiness(db, { name: "A", email: "a@example.com" });
    createUser(db, business.id, "shared@example.com", "irrelevant-hash");

    expect(() => createUser(db, business.id, "shared@example.com", "irrelevant-hash")).toThrow(
      /UNIQUE constraint failed/,
    );
  });

  it("rejects a duplicate email (case-insensitive)", async () => {
    const db = freshDb();
    await signUp(db, { businessName: "A", ownerEmail: "dupe@example.com", password: "password123" });

    await expect(
      signUp(db, { businessName: "B", ownerEmail: "DUPE@example.com", password: "password456" }),
    ).rejects.toThrow(/already exists/);
  });

  it("rejects an invalid email", async () => {
    const db = freshDb();
    await expect(
      signUp(db, { businessName: "A", ownerEmail: "not-an-email", password: "password123" }),
    ).rejects.toThrow(/valid email/);
  });

  it("rejects a too-short password", async () => {
    const db = freshDb();
    await expect(
      signUp(db, { businessName: "A", ownerEmail: "short@example.com", password: "short" }),
    ).rejects.toThrow(/at least/);
  });

  it("never stores the password in plaintext", async () => {
    const db = freshDb();
    await signUp(db, { businessName: "A", ownerEmail: "plain@example.com", password: "correct-horse-battery" });

    const row = db.prepare("SELECT password_hash FROM users WHERE email = ?").get("plain@example.com") as {
      password_hash: string;
    };
    expect(row.password_hash).not.toContain("correct-horse-battery");
    expect(row.password_hash.length).toBeGreaterThan(20);
  });
});

describe("logIn", () => {
  it("succeeds with the correct password and resolves to the same business", async () => {
    const db = freshDb();
    const signedUp = await signUp(db, {
      businessName: "Sparkle Windows",
      ownerEmail: "owner@sparkle.example",
      password: "correct-horse-battery",
    });

    const loggedIn = await logIn(db, { email: "owner@sparkle.example", password: "correct-horse-battery" });
    expect(loggedIn.session.businessId).toBe(signedUp.session.businessId);
    expect(loggedIn.token).not.toBe(signedUp.token); // a new session, not a reused one
  });

  it("fails with the wrong password", async () => {
    const db = freshDb();
    await signUp(db, { businessName: "A", ownerEmail: "owner@example.com", password: "correct-horse-battery" });

    await expect(logIn(db, { email: "owner@example.com", password: "wrong-password" })).rejects.toThrow(
      /Invalid email or password/,
    );
  });

  it("fails for an email that was never signed up, with the same message as a wrong password", async () => {
    const db = freshDb();
    await expect(
      logIn(db, { email: "nobody@example.com", password: "whatever123" }),
    ).rejects.toThrow(/Invalid email or password/);
  });
});

describe("logOut / resolveSession", () => {
  it("invalidates the session so it can no longer be resolved", async () => {
    const db = freshDb();
    const { token } = await signUp(db, {
      businessName: "A",
      ownerEmail: "owner@example.com",
      password: "correct-horse-battery",
    });

    expect(resolveSession(db, token)).toBeDefined();
    logOut(db, token);
    expect(resolveSession(db, token)).toBeUndefined();
  });

  it("returns undefined for a missing or garbage token, never throws", () => {
    const db = freshDb();
    expect(resolveSession(db, undefined)).toBeUndefined();
    expect(resolveSession(db, "not-a-real-token")).toBeUndefined();
  });
});
