import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "./testHarness";
import { signUp } from "../services/auth";
import { createQuote } from "../services/quotes";
import { generateShareLink } from "../services/quoteSharing";
import { deleteAccount, AccountDeletionError } from "../services/accountDeletion";
import { upsertSubscription } from "../repositories/subscriptions";
import { createBillingCharge } from "../repositories/billingCharges";
import { requestPasswordReset } from "../services/passwordReset";
import type { Queryable } from "../db/pg/client";

const getDb = useTestDb();

/**
 * V1 account/product features phase (see
 * docs/decisions/0019-account-settings-and-google-auth.md). Deletion and
 * subscription cancellation are separate concepts — these tests verify
 * both the Stripe-first ordering (Part 9 of the phase brief) and that
 * every tenant-owned table is actually cleared (Part 7/10), not just the
 * obvious ones.
 */

const sampleQuoteInput = () => ({
  customer: { name: "Jordan Rivera", email: "jordan@example.com" },
  property: { propertyType: "single-family" as const, stories: 1, address: "1 Test St" },
  servicePreferences: { interiorCleaning: false, screens: false, tracks: false, hardWaterTreatment: "unsure" as const },
  notes: "",
  photos: [],
  analysis: {
    characteristics: {
      vertical: "window-cleaning" as const,
      windowCount: 15,
      windowType: "double-hung" as const,
      paneCount: 0,
      stories: 1,
      screens: 0,
      tracks: 0,
      accessibility: "easy" as const,
      condition: "good" as const,
      hardWaterStaining: false,
      estimatedLaborHours: 1.5,
      interiorCleaning: false,
    },
    metadata: { confidence: "high" as const },
  },
});

async function setUp(email = "owner@sparkle.example") {
  const db = getDb();
  const { session } = await signUp(db, { businessName: "Sparkle Windows", ownerEmail: email, password: "correct-horse-battery" });
  return { db, session };
}

async function countRows(db: Queryable, table: string, businessId: string, column = "business_id"): Promise<number> {
  const result = await db.query<{ c: string }>(`SELECT COUNT(*) as c FROM ${table} WHERE ${column} = $1`, [businessId]);
  return Number(result.rows[0]!.c);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("deleteAccount — tenant data removal", () => {
  it("removes every tenant-owned table's rows for this business: quotes, customers, pricing configs, share tokens, subscriptions, billing charges, users, sessions, and the business itself", async () => {
    const { db, session } = await setUp();
    const quote = await createQuote(db, session, sampleQuoteInput());
    await generateShareLink(db, session, quote.id);
    await upsertSubscription(db, session.businessId, { planId: "growth", status: "active" });
    await createBillingCharge(db, session.businessId, { kind: "website_installation", amountCents: 29900, currency: "USD" });
    await requestPasswordReset(db, "owner@sparkle.example", (token) => `https://x/reset?token=${token}`);

    // Sanity: confirm everything actually exists before deleting.
    expect(await countRows(db, "quotes", session.businessId)).toBe(1);
    expect(await countRows(db, "customers", session.businessId)).toBe(1);
    expect(await countRows(db, "pricing_configurations", session.businessId)).toBe(1);
    expect(await countRows(db, "quote_share_tokens", session.businessId)).toBe(1);
    expect(await countRows(db, "subscriptions", session.businessId)).toBe(1);
    expect(await countRows(db, "billing_charges", session.businessId)).toBe(1);
    expect(await countRows(db, "sessions", session.businessId)).toBeGreaterThan(0);
    const userIdResult = await db.query<{ id: string }>("SELECT id FROM users WHERE business_id = $1", [session.businessId]);
    const userId = userIdResult.rows[0]!.id;
    expect(await countRows(db, "password_reset_tokens", userId, "user_id")).toBe(1);

    await deleteAccount(db, session);

    for (const table of ["quotes", "customers", "pricing_configurations", "quote_share_tokens", "subscriptions", "billing_charges", "sessions", "users"]) {
      expect(await countRows(db, table, session.businessId)).toBe(0);
    }
    const businessResult = await db.query("SELECT * FROM businesses WHERE id = $1", [session.businessId]);
    expect(businessResult.rows[0]).toBeUndefined();
    expect(await countRows(db, "password_reset_tokens", userId, "user_id")).toBe(0);
  });

  it("does NOT touch a different business's data", async () => {
    const db = getDb();
    const { session: sessionA } = await signUp(db, { businessName: "Business A", ownerEmail: "a@example.com", password: "correct-horse-battery" });
    const { session: sessionB } = await signUp(db, { businessName: "Business B", ownerEmail: "b@example.com", password: "correct-horse-battery" });
    await createQuote(db, sessionA, sampleQuoteInput());
    await createQuote(db, sessionB, sampleQuoteInput());

    await deleteAccount(db, sessionA);

    const businessBResult = await db.query("SELECT * FROM businesses WHERE id = $1", [sessionB.businessId]);
    expect(businessBResult.rows[0]).toBeTruthy();
    expect(await countRows(db, "quotes", sessionB.businessId)).toBe(1);
  });
});

describe("deleteAccount — Stripe-first ordering", () => {
  it("cancels a real, active Stripe subscription BEFORE deleting local data", async () => {
    const { db, session } = await setUp();
    await upsertSubscription(db, session.businessId, { planId: "growth", status: "active", providerSubscriptionId: "sub_real_123" });

    const billing = await import("../billing");
    const spy = vi.spyOn(billing, "cancelSubscriptionImmediately").mockResolvedValue(undefined);

    await deleteAccount(db, session);

    expect(spy).toHaveBeenCalledWith("sub_real_123");
    const businessResult = await db.query("SELECT * FROM businesses WHERE id = $1", [session.businessId]);
    expect(businessResult.rows[0]).toBeUndefined();
  });

  it("does NOT call Stripe when there's no subscription at all (legacy/never-subscribed business)", async () => {
    const { db, session } = await setUp();
    const billing = await import("../billing");
    const spy = vi.spyOn(billing, "cancelSubscriptionImmediately");

    await deleteAccount(db, session);

    expect(spy).not.toHaveBeenCalled();
  });

  it("does NOT call Stripe when the subscription is already canceled", async () => {
    const { db, session } = await setUp();
    await upsertSubscription(db, session.businessId, { planId: "growth", status: "canceled", providerSubscriptionId: "sub_already_gone" });
    const billing = await import("../billing");
    const spy = vi.spyOn(billing, "cancelSubscriptionImmediately");

    await deleteAccount(db, session);

    expect(spy).not.toHaveBeenCalled();
  });

  it("aborts entirely and deletes NOTHING when Stripe cancellation fails — a safe, recoverable error, not a partial deletion", async () => {
    const { db, session } = await setUp();
    await upsertSubscription(db, session.businessId, { planId: "growth", status: "active", providerSubscriptionId: "sub_will_fail" });
    await createQuote(db, session, sampleQuoteInput());

    const billing = await import("../billing");
    vi.spyOn(billing, "cancelSubscriptionImmediately").mockRejectedValue(new Error("Stripe is down"));

    await expect(deleteAccount(db, session)).rejects.toThrow(AccountDeletionError);

    // Nothing was deleted — the business, its subscription, and its quote all still exist.
    const businessResult = await db.query("SELECT * FROM businesses WHERE id = $1", [session.businessId]);
    expect(businessResult.rows[0]).toBeTruthy();
    expect(await countRows(db, "subscriptions", session.businessId)).toBe(1);
    expect(await countRows(db, "quotes", session.businessId)).toBe(1);
  });
});

describe("deleteAccount — session revocation and idempotency", () => {
  it("revokes every session for this user", async () => {
    const { db, session } = await setUp();
    expect(await countRows(db, "sessions", session.businessId)).toBeGreaterThan(0);

    await deleteAccount(db, session);

    expect(await countRows(db, "sessions", session.userId, "user_id")).toBe(0);
  });

  it("a second, sequential call with the same (now-stale) session completes harmlessly rather than throwing", async () => {
    const { db, session } = await setUp();
    await deleteAccount(db, session);

    await expect(deleteAccount(db, session)).resolves.toBeUndefined();
  });

  it("rejects a second CONCURRENT deletion attempt for the same business while the first is still in flight", async () => {
    const { db, session } = await setUp();
    await upsertSubscription(db, session.businessId, { planId: "growth", status: "active", providerSubscriptionId: "sub_slow" });

    const billing = await import("../billing");
    let resolveFirst!: () => void;
    const firstCallPending = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    vi.spyOn(billing, "cancelSubscriptionImmediately").mockReturnValueOnce(firstCallPending);

    const firstDeletion = deleteAccount(db, session);
    await expect(deleteAccount(db, session)).rejects.toThrow(/already in progress/i);

    resolveFirst();
    await expect(firstDeletion).resolves.toBeUndefined();
  });
});
