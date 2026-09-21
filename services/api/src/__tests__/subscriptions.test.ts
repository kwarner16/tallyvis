import { describe, expect, it } from "vitest";
import { WEBSITE_INSTALLATION_FEE } from "@tallyvis/config";
import { createTestDb } from "../db/client";
import { signUp } from "../services/auth";
import { createQuote } from "../services/quotes";
import {
  getSubscription,
  hasProductAccess,
  listBillingCharges,
  resolveEffectiveStatus,
  startTrial,
} from "../services/subscriptions";
import type { Subscription } from "../repositories/subscriptions";
import type { AuthSession } from "../auth/session";

/**
 * Phase 14 — SaaS plan/trial/subscription foundation (see
 * docs/decisions/0016-onboarding-billing-embed.md).
 */

const sampleQuoteInput = () => ({
  customer: { name: "Jordan Rivera", email: "jordan@example.com" },
  property: { propertyType: "single-family" as const, stories: 1 },
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

async function setUp(): Promise<{ db: ReturnType<typeof createTestDb>; session: AuthSession }> {
  const db = createTestDb();
  const { session } = await signUp(db, {
    businessName: "Sparkle Windows",
    ownerEmail: "owner@sparkle.example",
    password: "correct-horse-battery",
  });
  return { db, session };
}

describe("startTrial", () => {
  it("creates a trialing subscription with a 7-day window for a valid plan", async () => {
    const { db, session } = await setUp();
    const before = Date.now();

    const subscription = startTrial(db, session, "growth");

    expect(subscription.planId).toBe("growth");
    expect(subscription.status).toBe("trialing");
    expect(subscription.trialStartedAt).toBeTruthy();
    expect(subscription.trialEndsAt).toBeTruthy();
    const trialMs = new Date(subscription.trialEndsAt!).getTime() - new Date(subscription.trialStartedAt!).getTime();
    expect(trialMs).toBeCloseTo(7 * 24 * 60 * 60 * 1000, -3);
    expect(new Date(subscription.trialEndsAt!).getTime()).toBeGreaterThan(before);
  });

  it("rejects an unknown plan id", async () => {
    const { db, session } = await setUp();
    expect(() => startTrial(db, session, "not-a-real-plan")).toThrow(/unknown plan/i);
  });

  it("records the one-time website installation fee separately from the subscription, as a pending charge", async () => {
    const { db, session } = await setUp();
    startTrial(db, session, "starter");

    const charges = listBillingCharges(db, session);
    expect(charges).toHaveLength(1);
    expect(charges[0]).toMatchObject({
      kind: "website_installation",
      status: "pending",
      amountCents: WEBSITE_INSTALLATION_FEE.amountCents,
      currency: WEBSITE_INSTALLATION_FEE.currency,
    });
  });

  it("does not duplicate the installation charge if a trial is started more than once", async () => {
    const { db, session } = await setUp();
    startTrial(db, session, "starter");
    startTrial(db, session, "growth"); // e.g. switching plans before the trial ends

    expect(listBillingCharges(db, session)).toHaveLength(1);
  });

  it("persists and is retrievable via getSubscription", async () => {
    const { db, session } = await setUp();
    startTrial(db, session, "pro");
    expect(getSubscription(db, session)?.planId).toBe("pro");
  });
});

describe("resolveEffectiveStatus", () => {
  function subscriptionWith(overrides: Partial<Subscription>): Subscription {
    return {
      id: "sub_1",
      businessId: "biz_1",
      planId: "starter",
      status: "trialing",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  it("reports a trial still within its window as trialing", () => {
    const sub = subscriptionWith({ status: "trialing", trialEndsAt: new Date(Date.now() + 60_000).toISOString() });
    expect(resolveEffectiveStatus(sub)).toBe("trialing");
  });

  it("reports a trial past its trialEndsAt as expired, even though the stored status still says trialing", () => {
    const sub = subscriptionWith({ status: "trialing", trialEndsAt: new Date(Date.now() - 60_000).toISOString() });
    expect(resolveEffectiveStatus(sub)).toBe("expired");
  });

  it("leaves a non-trialing status exactly as stored", () => {
    expect(resolveEffectiveStatus(subscriptionWith({ status: "active" }))).toBe("active");
    expect(resolveEffectiveStatus(subscriptionWith({ status: "canceled" }))).toBe("canceled");
  });
});

describe("hasProductAccess — server-authoritative gate", () => {
  it("grants access when there is no subscription row at all (legacy/pre-billing business)", () => {
    expect(hasProductAccess(undefined)).toBe(true);
  });

  it("grants access while trialing", async () => {
    const { db, session } = await setUp();
    const sub = startTrial(db, session, "starter");
    expect(hasProductAccess(sub)).toBe(true);
  });

  it("denies access once the trial has expired", async () => {
    const { db, session } = await setUp();
    const sub = startTrial(db, session, "starter");
    const expired = { ...sub, trialEndsAt: new Date(Date.now() - 1000).toISOString() };
    expect(hasProductAccess(expired)).toBe(false);
  });

  it("denies access for a canceled subscription", () => {
    expect(
      hasProductAccess({
        id: "sub_1",
        businessId: "biz_1",
        planId: "starter",
        status: "canceled",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    ).toBe(false);
  });
});

describe("createQuote — subscription gate integration", () => {
  it("still allows quote creation for a business with no subscription row (unaffected by this phase)", async () => {
    const { db, session } = await setUp();
    const quote = createQuote(db, session, sampleQuoteInput());
    expect(quote.id).toBeTruthy();
  });

  it("allows quote creation while trialing", async () => {
    const { db, session } = await setUp();
    startTrial(db, session, "starter");
    const quote = createQuote(db, session, sampleQuoteInput());
    expect(quote.id).toBeTruthy();
  });

  it("blocks quote creation once the trial has expired", async () => {
    const { db, session } = await setUp();
    startTrial(db, session, "starter");

    const { upsertSubscription } = await import("../repositories/subscriptions");
    const sub = getSubscription(db, session)!;
    upsertSubscription(db, session.businessId, {
      planId: sub.planId,
      status: "trialing",
      trialStartedAt: sub.trialStartedAt,
      trialEndsAt: new Date(Date.now() - 1000).toISOString(),
    });

    expect(() => createQuote(db, session, sampleQuoteInput())).toThrow(/trial or subscription has ended/);
  });
});

describe("business isolation", () => {
  it("Business B's subscription/trial is entirely independent of Business A's", async () => {
    const dbA = createTestDb();
    const { session: sessionA } = await signUp(dbA, {
      businessName: "Business A",
      ownerEmail: "a@example.com",
      password: "password-a1",
    });
    const { session: sessionB } = await signUp(dbA, {
      businessName: "Business B",
      ownerEmail: "b@example.com",
      password: "password-b1",
    });

    startTrial(dbA, sessionA, "pro");
    expect(getSubscription(dbA, sessionB)).toBeUndefined();
    expect(getSubscription(dbA, sessionA)?.planId).toBe("pro");
  });
});
