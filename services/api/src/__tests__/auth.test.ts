import { describe, expect, it, vi } from "vitest";
import { useTestDb } from "./testHarness";
import { logIn, logOut, resolveSession, signUp } from "../services/auth";
import { createBusiness } from "../repositories/businesses";
import { createUser } from "../repositories/users";

const getDb = useTestDb();

describe("signUp", () => {
  it("creates a business, an owner user, a starter pricing configuration, and a session", async () => {
    const db = getDb();
    const result = await signUp(db, {
      businessName: "Sparkle Windows",
      ownerEmail: "owner@sparkle.example",
      password: "correct-horse-battery",
    });

    expect(result.session.businessId).toBeTruthy();
    expect(result.token).toBeTruthy();

    const resolved = await resolveSession(db, result.token);
    expect(resolved).toEqual(result.session);
  });

  it("rejects a duplicate email and leaves no orphaned business behind", async () => {
    const db = getDb();
    await signUp(db, { businessName: "A", ownerEmail: "dupe@example.com", password: "password123" });
    const before = await db.query<{ c: string }>("SELECT COUNT(*) AS c FROM businesses");
    const businessCountBefore = Number(before.rows[0]!.c);

    await expect(
      signUp(db, { businessName: "B", ownerEmail: "dupe@example.com", password: "password456" }),
    ).rejects.toThrow(/already exists/);

    const after = await db.query<{ c: string }>("SELECT COUNT(*) AS c FROM businesses");
    const businessCountAfter = Number(after.rows[0]!.c);
    expect(businessCountAfter).toBe(businessCountBefore);
  });

  it("the database itself enforces email uniqueness as a last line of defense (defense in depth behind the application-level check above)", async () => {
    const db = getDb();
    const business = await createBusiness(db, { name: "A", email: "a@example.com" });
    await createUser(db, business.id, "shared@example.com", "irrelevant-hash");

    await expect(createUser(db, business.id, "shared@example.com", "irrelevant-hash")).rejects.toMatchObject({
      code: "23505",
    });
  });

  it("rejects a duplicate email (case-insensitive)", async () => {
    const db = getDb();
    await signUp(db, { businessName: "A", ownerEmail: "dupe@example.com", password: "password123" });

    await expect(
      signUp(db, { businessName: "B", ownerEmail: "DUPE@example.com", password: "password456" }),
    ).rejects.toThrow(/already exists/);
  });

  it("rejects an invalid email", async () => {
    const db = getDb();
    await expect(
      signUp(db, { businessName: "A", ownerEmail: "not-an-email", password: "password123" }),
    ).rejects.toThrow(/valid email/);
  });

  it("rejects a too-short password", async () => {
    const db = getDb();
    await expect(
      signUp(db, { businessName: "A", ownerEmail: "short@example.com", password: "short" }),
    ).rejects.toThrow(/at least/);
  });

  it("never stores the password in plaintext", async () => {
    const db = getDb();
    await signUp(db, { businessName: "A", ownerEmail: "plain@example.com", password: "correct-horse-battery" });

    const result = await db.query<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE email = $1",
      ["plain@example.com"],
    );
    const row = result.rows[0]!;
    expect(row.password_hash).not.toContain("correct-horse-battery");
    expect(row.password_hash.length).toBeGreaterThan(20);
  });
});

describe("logIn", () => {
  it("succeeds with the correct password and resolves to the same business", async () => {
    const db = getDb();
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
    const db = getDb();
    await signUp(db, { businessName: "A", ownerEmail: "owner@example.com", password: "correct-horse-battery" });

    await expect(logIn(db, { email: "owner@example.com", password: "wrong-password" })).rejects.toThrow(
      /Invalid email or password/,
    );
  });

  it("fails for an email that was never signed up, with the same message as a wrong password", async () => {
    const db = getDb();
    await expect(
      logIn(db, { email: "nobody@example.com", password: "whatever123" }),
    ).rejects.toThrow(/Invalid email or password/);
  });

  it("performs the same bcrypt comparison work for a nonexistent email as for a wrong password (timing-safe against account enumeration)", async () => {
    const db = getDb();
    await signUp(db, { businessName: "A", ownerEmail: "owner@example.com", password: "correct-horse-battery" });

    const password = await import("../auth/password");
    const spy = vi.spyOn(password, "verifyPassword");

    await expect(logIn(db, { email: "nobody@example.com", password: "whatever123" })).rejects.toThrow();
    // Without the fix, a nonexistent email would short-circuit before ever
    // calling verifyPassword — making that response measurably faster than
    // a real wrong-password attempt and leaking account existence via
    // timing even though the error message is identical.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![1]).toBe(password.DUMMY_PASSWORD_HASH_FOR_TIMING_SAFETY);

    vi.restoreAllMocks();
  });
});

describe("logOut / resolveSession", () => {
  it("invalidates the session so it can no longer be resolved", async () => {
    const db = getDb();
    const { token } = await signUp(db, {
      businessName: "A",
      ownerEmail: "owner@example.com",
      password: "correct-horse-battery",
    });

    expect(await resolveSession(db, token)).toBeDefined();
    await logOut(db, token);
    expect(await resolveSession(db, token)).toBeUndefined();
  });

  it("returns undefined for a missing or garbage token, never throws", async () => {
    const db = getDb();
    expect(await resolveSession(db, undefined)).toBeUndefined();
    expect(await resolveSession(db, "not-a-real-token")).toBeUndefined();
  });
});
