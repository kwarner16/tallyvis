import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROFESSIONAL_INSTALLATION_FEE } from "@tallyvis/config";
import { createTestDb } from "../db/client";
import { signUp } from "../services/auth";
import { createQuote } from "../services/quotes";
import {
  chooseSelfInstall,
  createBillingPortalSession,
  createCheckoutSessionForPlan,
  createInstallationCheckoutSession,
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

  it("does NOT create an installation charge as a side effect — installation is now an explicit, separate choice (see createInstallationCheckoutSession/chooseSelfInstall below)", async () => {
    const { db, session } = await setUp();
    startTrial(db, session, "starter");
    expect(listBillingCharges(db, session)).toHaveLength(0);
  });

  it("persists and is retrievable via getSubscription", async () => {
    const { db, session } = await setUp();
    startTrial(db, session, "pro");
    expect(getSubscription(db, session)?.planId).toBe("pro");
  });
});

describe("startTrial — hardening: repeated/duplicate plan selection", () => {
  it("does not reset the trial clock when the same plan is re-selected while already trialing (idempotent repeated selection)", async () => {
    const { db, session } = await setUp();
    const first = startTrial(db, session, "starter");

    // A later "clock" — if the bug were present, re-selecting would push trialEndsAt further out.
    const second = startTrial(db, session, "starter");

    expect(second.trialStartedAt).toBe(first.trialStartedAt);
    expect(second.trialEndsAt).toBe(first.trialEndsAt);
  });

  it("does not reset the trial clock when switching to a DIFFERENT plan mid-trial — only planId changes", async () => {
    const { db, session } = await setUp();
    const first = startTrial(db, session, "starter");

    const switched = startTrial(db, session, "pro");

    expect(switched.planId).toBe("pro");
    expect(switched.trialStartedAt).toBe(first.trialStartedAt);
    expect(switched.trialEndsAt).toBe(first.trialEndsAt);
  });

  it("does not create a second subscription row on repeated selection — still exactly one row for the business", async () => {
    const { db, session } = await setUp();
    const first = startTrial(db, session, "starter");
    const second = startTrial(db, session, "growth");
    expect(second.id).toBe(first.id);
  });

  it("DOES grant a fresh 7-day trial when reactivating a canceled/expired subscription", async () => {
    const { db, session } = await setUp();
    startTrial(db, session, "starter");

    const { upsertSubscription } = await import("../repositories/subscriptions");
    upsertSubscription(db, session.businessId, { planId: "starter", status: "canceled" });

    const reactivated = startTrial(db, session, "growth");
    expect(reactivated.status).toBe("trialing");
    const freshTrialMs =
      new Date(reactivated.trialEndsAt!).getTime() - new Date(reactivated.trialStartedAt!).getTime();
    expect(freshTrialMs).toBeCloseTo(7 * 24 * 60 * 60 * 1000, -3);
    expect(new Date(reactivated.trialEndsAt!).getTime()).toBeGreaterThan(Date.now());
  });

  it("never wipes an already-linked Stripe customer/subscription id when re-selecting a plan (regression: upsertSubscription used to fully overwrite every column)", async () => {
    const { db, session } = await setUp();
    startTrial(db, session, "starter");

    const { upsertSubscription } = await import("../repositories/subscriptions");
    upsertSubscription(db, session.businessId, {
      planId: "starter",
      status: "trialing",
      billingCustomerId: "cus_already_linked",
      providerSubscriptionId: "sub_already_linked",
    });

    startTrial(db, session, "growth"); // re-selecting must not erase the Stripe identifiers above

    const after = getSubscription(db, session)!;
    expect(after.billingCustomerId).toBe("cus_already_linked");
    expect(after.providerSubscriptionId).toBe("sub_already_linked");
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

  it("Business B's installation choice is entirely independent of Business A's, and a portal session always resolves the CALLER's own Stripe Customer", async () => {
    const dbA = createTestDb();
    const { session: sessionA } = await signUp(dbA, {
      businessName: "Business A",
      ownerEmail: "isoA@example.com",
      password: "password-a1",
    });
    const { session: sessionB } = await signUp(dbA, {
      businessName: "Business B",
      ownerEmail: "isoB@example.com",
      password: "password-b1",
    });

    chooseSelfInstall(dbA, sessionA);
    expect(listBillingCharges(dbA, sessionB)).toHaveLength(0);
    expect(listBillingCharges(dbA, sessionA)).toHaveLength(1);

    const { upsertSubscription } = await import("../repositories/subscriptions");
    upsertSubscription(dbA, sessionA.businessId, { planId: "starter", status: "active", billingCustomerId: "cus_business_a" });
    upsertSubscription(dbA, sessionB.businessId, { planId: "starter", status: "active", billingCustomerId: "cus_business_b" });

    const billing = await import("../billing");
    const spy = vi.spyOn(billing, "createPortalSession").mockResolvedValue({ url: "https://billing.stripe.example/p/session" });

    await createBillingPortalSession(dbA, sessionB, "https://x/return");
    // Business B's own session must resolve to Business B's Stripe Customer — never A's, even though both rows exist in the same db.
    expect(spy.mock.calls[0]![0].customerId).toBe("cus_business_b");

    vi.restoreAllMocks();
  });
});

describe("createCheckoutSessionForPlan", () => {
  beforeEach(() => {
    process.env.STRIPE_PRICE_STARTER = "price_test_starter";
    process.env.STRIPE_PRICE_GROWTH = "price_test_growth";
    process.env.STRIPE_PRICE_PRO = "price_test_pro";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_PRICE_STARTER;
    delete process.env.STRIPE_PRICE_GROWTH;
    delete process.env.STRIPE_PRICE_PRO;
  });

  it("throws a categorized, safe 'not-configured' error when no Price id is configured for the plan — never an opaque failure", async () => {
    const { db, session } = await setUp();
    delete process.env.STRIPE_PRICE_GROWTH;

    const { BillingProviderError } = await import("../billing");
    try {
      await createCheckoutSessionForPlan(db, session, "growth", { successUrl: "https://x/success", cancelUrl: "https://x/cancel" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(BillingProviderError);
      expect((err as InstanceType<typeof BillingProviderError>).category).toBe("not-configured");
      // The message shown to a business owner is plain and actionable —
      // no env var names or other internal config details, which belong
      // in server logs only.
      expect((err as InstanceType<typeof BillingProviderError>).message).toBe(
        "Billing isn't configured yet. Please contact the Tallyvis team.",
      );
      expect((err as InstanceType<typeof BillingProviderError>).message).not.toContain("STRIPE_PRICE_GROWTH");
    }
  });

  it("rejects an unknown plan id before ever calling the billing provider", async () => {
    const { db, session } = await setUp();
    const billing = await import("../billing");
    const spy = vi.spyOn(billing, "createCheckoutSession");

    await expect(
      createCheckoutSessionForPlan(db, session, "not-a-real-plan", { successUrl: "https://x/success", cancelUrl: "https://x/cancel" }),
    ).rejects.toThrow(/unknown plan/i);
    expect(spy).not.toHaveBeenCalled();
  });

  it("derives the Price id and business identity entirely server-side — the caller supplies only a planId, never a price/priceId/businessId — and persists the checkout session id", async () => {
    const { db, session } = await setUp();
    const billing = await import("../billing");
    const spy = vi.spyOn(billing, "createCheckoutSession").mockResolvedValue({
      id: "cs_test_mocked",
      url: "https://checkout.stripe.example/cs_test_mocked",
    });

    const result = await createCheckoutSessionForPlan(db, session, "pro", {
      successUrl: "https://x/success",
      cancelUrl: "https://x/cancel",
    });

    expect(result.url).toBe("https://checkout.stripe.example/cs_test_mocked");
    expect(spy).toHaveBeenCalledTimes(1);
    const callArg = spy.mock.calls[0]![0];
    // The Price id sent to the provider is resolved server-side from
    // STRIPE_PRICE_PRO — there is no parameter through which a caller
    // could have supplied a different price.
    expect(callArg.priceId).toBe("price_test_pro");
    expect(callArg.mode).toBe("subscription");
    expect(callArg.trialDays).toBe(7);
    // Business identity in the metadata is the session's own businessId —
    // `createCheckoutSessionForPlan`'s signature has no businessId
    // parameter a caller could substitute here.
    expect(callArg.metadata.businessId).toBe(session.businessId);

    expect(getSubscription(db, session)?.providerCheckoutSessionId).toBe("cs_test_mocked");
  });

  it("uses customer_email (no customerId) for a business's first-ever checkout", async () => {
    const { db, session } = await setUp();
    const billing = await import("../billing");
    const spy = vi
      .spyOn(billing, "createCheckoutSession")
      .mockResolvedValue({ id: "cs_test_first", url: "https://checkout.stripe.example/cs_test_first" });

    await createCheckoutSessionForPlan(db, session, "starter", { successUrl: "https://x/success", cancelUrl: "https://x/cancel" });

    const callArg = spy.mock.calls[0]![0];
    expect(callArg.customerId).toBeUndefined();
    expect(callArg.customerEmail).toBe("owner@sparkle.example");
  });

  it("reuses an already-linked Stripe Customer id instead of customer_email, avoiding a duplicate Customer", async () => {
    const { db, session } = await setUp();
    const { upsertSubscription } = await import("../repositories/subscriptions");
    upsertSubscription(db, session.businessId, {
      planId: "starter",
      status: "trialing",
      billingCustomerId: "cus_already_linked",
    });

    const billing = await import("../billing");
    const spy = vi
      .spyOn(billing, "createCheckoutSession")
      .mockResolvedValue({ id: "cs_test_second", url: "https://checkout.stripe.example/cs_test_second" });

    await createCheckoutSessionForPlan(db, session, "growth", { successUrl: "https://x/success", cancelUrl: "https://x/cancel" });

    const callArg = spy.mock.calls[0]![0];
    expect(callArg.customerId).toBe("cus_already_linked");
    expect(callArg.customerEmail).toBeUndefined();
  });

  it("does not mark the subscription active/trialing itself — status is left exactly as it was until a webhook confirms it (regression: the previous createCheckoutSessionForPlan/webhook pairing used to hardcode active)", async () => {
    const { db, session } = await setUp();
    const billing = await import("../billing");
    vi.spyOn(billing, "createCheckoutSession").mockResolvedValue({
      id: "cs_test_mocked",
      url: "https://checkout.stripe.example/cs_test_mocked",
    });

    await createCheckoutSessionForPlan(db, session, "growth", { successUrl: "https://x/success", cancelUrl: "https://x/cancel" });

    expect(getSubscription(db, session)?.status).toBe("incomplete");
  });

  it("propagates a BillingProviderError from the provider layer as-is (already a safe, categorized message)", async () => {
    const { db, session } = await setUp();
    const billing = await import("../billing");
    vi.spyOn(billing, "createCheckoutSession").mockRejectedValue(
      new billing.BillingProviderError("The billing provider rejected the configured credentials.", "provider-error"),
    );

    await expect(
      createCheckoutSessionForPlan(db, session, "starter", { successUrl: "https://x/success", cancelUrl: "https://x/cancel" }),
    ).rejects.toThrow(/rejected the configured credentials/);
  });

  it("regression: a second concurrent call for the same business while the first is still awaiting Stripe is rejected, rather than creating a second real Checkout Session (a double-click could otherwise create two real Stripe subscriptions before either write lands locally)", async () => {
    const { db, session } = await setUp();
    const billing = await import("../billing");
    let resolveFirst!: (value: { id: string; url: string }) => void;
    const firstCallPending = new Promise<{ id: string; url: string }>((resolve) => {
      resolveFirst = resolve;
    });
    vi.spyOn(billing, "createCheckoutSession").mockReturnValueOnce(firstCallPending);

    const firstCall = createCheckoutSessionForPlan(db, session, "growth", {
      successUrl: "https://x/success",
      cancelUrl: "https://x/cancel",
    });

    // The second attempt happens while the first is still awaiting Stripe — must be rejected immediately.
    await expect(
      createCheckoutSessionForPlan(db, session, "growth", { successUrl: "https://x/success", cancelUrl: "https://x/cancel" }),
    ).rejects.toThrow(/already in progress/i);

    resolveFirst({ id: "cs_test_race", url: "https://checkout.stripe.example/cs_test_race" });
    await expect(firstCall).resolves.toEqual({ url: "https://checkout.stripe.example/cs_test_race" });

    // The guard is released once the first call finishes — a later, non-concurrent attempt succeeds normally.
    vi.spyOn(billing, "createCheckoutSession").mockResolvedValueOnce({
      id: "cs_test_after",
      url: "https://checkout.stripe.example/cs_test_after",
    });
    await expect(
      createCheckoutSessionForPlan(db, session, "growth", { successUrl: "https://x/success", cancelUrl: "https://x/cancel" }),
    ).resolves.toEqual({ url: "https://checkout.stripe.example/cs_test_after" });
  });

  it("releases the in-flight guard even when the provider call fails, so a failed attempt doesn't permanently lock out retries", async () => {
    const { db, session } = await setUp();
    const billing = await import("../billing");
    vi.spyOn(billing, "createCheckoutSession").mockRejectedValueOnce(new Error("network blip"));

    await expect(
      createCheckoutSessionForPlan(db, session, "growth", { successUrl: "https://x/success", cancelUrl: "https://x/cancel" }),
    ).rejects.toThrow();

    vi.spyOn(billing, "createCheckoutSession").mockResolvedValueOnce({
      id: "cs_test_retry",
      url: "https://checkout.stripe.example/cs_test_retry",
    });
    await expect(
      createCheckoutSessionForPlan(db, session, "growth", { successUrl: "https://x/success", cancelUrl: "https://x/cancel" }),
    ).resolves.toEqual({ url: "https://checkout.stripe.example/cs_test_retry" });
  });
});

describe("createInstallationCheckoutSession", () => {
  beforeEach(() => {
    process.env.STRIPE_PRICE_INSTALLATION = "price_test_installation";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.STRIPE_PRICE_INSTALLATION;
  });

  it("creates a pending charge and a payment-mode checkout session with the charge id in metadata", async () => {
    const { db, session } = await setUp();
    const billing = await import("../billing");
    const spy = vi
      .spyOn(billing, "createCheckoutSession")
      .mockResolvedValue({ id: "cs_test_install", url: "https://checkout.stripe.example/cs_test_install" });

    const result = await createInstallationCheckoutSession(db, session, {
      successUrl: "https://x/installation-success",
      cancelUrl: "https://x/installation-cancel",
    });

    expect(result.url).toBe("https://checkout.stripe.example/cs_test_install");
    const callArg = spy.mock.calls[0]![0];
    expect(callArg.mode).toBe("payment");
    expect(callArg.priceId).toBe("price_test_installation");
    expect(callArg.metadata.businessId).toBe(session.businessId);

    const charges = listBillingCharges(db, session);
    expect(charges).toHaveLength(1);
    expect(charges[0]).toMatchObject({
      kind: "website_installation",
      status: "pending",
      amountCents: PROFESSIONAL_INSTALLATION_FEE.amountCents,
    });
    expect(callArg.metadata.billingChargeId).toBe(charges[0]!.id);
  });

  it("reuses the same pending charge (does not create a duplicate) on a second attempt", async () => {
    const { db, session } = await setUp();
    const billing = await import("../billing");
    vi.spyOn(billing, "createCheckoutSession").mockResolvedValue({
      id: "cs_test_install",
      url: "https://checkout.stripe.example/cs_test_install",
    });

    await createInstallationCheckoutSession(db, session, { successUrl: "https://x/s", cancelUrl: "https://x/c" });
    await createInstallationCheckoutSession(db, session, { successUrl: "https://x/s", cancelUrl: "https://x/c" });

    expect(listBillingCharges(db, session)).toHaveLength(1);
  });

  it("refuses to start a new checkout once the charge has already been paid", async () => {
    const { db, session } = await setUp();
    const billing = await import("../billing");
    vi.spyOn(billing, "createCheckoutSession").mockResolvedValue({
      id: "cs_test_install",
      url: "https://checkout.stripe.example/cs_test_install",
    });
    await createInstallationCheckoutSession(db, session, { successUrl: "https://x/s", cancelUrl: "https://x/c" });
    const { markBillingChargeStatus } = await import("../repositories/billingCharges");
    markBillingChargeStatus(db, listBillingCharges(db, session)[0]!.id, "paid", "pi_test_123");

    await expect(
      createInstallationCheckoutSession(db, session, { successUrl: "https://x/s", cancelUrl: "https://x/c" }),
    ).rejects.toThrow(/already been resolved/i);
  });

  it("refuses to start a new checkout once self-install has already been chosen", async () => {
    const { db, session } = await setUp();
    chooseSelfInstall(db, session);

    await expect(
      createInstallationCheckoutSession(db, session, { successUrl: "https://x/s", cancelUrl: "https://x/c" }),
    ).rejects.toThrow(/already been resolved/i);
  });

  it("regression: a second concurrent installation-checkout attempt while the first is still awaiting Stripe is rejected, rather than creating a second pending $299 charge (billing_charges has no unique constraint on business_id+kind, so this could otherwise double-charge)", async () => {
    const { db, session } = await setUp();
    const billing = await import("../billing");
    let resolveFirst!: (value: { id: string; url: string }) => void;
    const firstCallPending = new Promise<{ id: string; url: string }>((resolve) => {
      resolveFirst = resolve;
    });
    vi.spyOn(billing, "createCheckoutSession").mockReturnValueOnce(firstCallPending);

    const firstCall = createInstallationCheckoutSession(db, session, { successUrl: "https://x/s", cancelUrl: "https://x/c" });

    await expect(
      createInstallationCheckoutSession(db, session, { successUrl: "https://x/s", cancelUrl: "https://x/c" }),
    ).rejects.toThrow(/already in progress/i);

    resolveFirst({ id: "cs_test_install_race", url: "https://checkout.stripe.example/cs_test_install_race" });
    await firstCall;

    // Only ONE billing_charges row exists — the concurrent attempt never got far enough to create a second one.
    expect(listBillingCharges(db, session)).toHaveLength(1);
  });
});

describe("chooseSelfInstall", () => {
  it("records a $0, immediately-waived charge — never calls the billing provider", async () => {
    const { db, session } = await setUp();
    const billing = await import("../billing");
    const spy = vi.spyOn(billing, "createCheckoutSession");

    const charge = chooseSelfInstall(db, session);

    expect(charge).toMatchObject({ kind: "website_installation", status: "waived", amountCents: 0 });
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses if installation has already been resolved (e.g. professional installation already chosen)", async () => {
    const { db, session } = await setUp();
    process.env.STRIPE_PRICE_INSTALLATION = "price_test_installation";
    try {
      const billing = await import("../billing");
      vi.spyOn(billing, "createCheckoutSession").mockResolvedValue({
        id: "cs_test_install",
        url: "https://checkout.stripe.example/cs_test_install",
      });
      await createInstallationCheckoutSession(db, session, { successUrl: "https://x/s", cancelUrl: "https://x/c" });

      expect(() => chooseSelfInstall(db, session)).toThrow(/already been resolved/i);
    } finally {
      delete process.env.STRIPE_PRICE_INSTALLATION;
      vi.restoreAllMocks();
    }
  });
});

describe("createBillingPortalSession", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refuses when this business has no Stripe Customer on file yet", async () => {
    const { db, session } = await setUp();
    await expect(createBillingPortalSession(db, session, "https://x/return")).rejects.toThrow(/no billing account/i);
  });

  it("creates a portal session for this business's own Stripe Customer id", async () => {
    const { db, session } = await setUp();
    const { upsertSubscription } = await import("../repositories/subscriptions");
    upsertSubscription(db, session.businessId, { planId: "starter", status: "active", billingCustomerId: "cus_owned_by_this_business" });

    const billing = await import("../billing");
    const spy = vi.spyOn(billing, "createPortalSession").mockResolvedValue({ url: "https://billing.stripe.example/p/session_1" });

    const result = await createBillingPortalSession(db, session, "https://x/return");

    expect(result.url).toBe("https://billing.stripe.example/p/session_1");
    expect(spy.mock.calls[0]![0]).toMatchObject({ customerId: "cus_owned_by_this_business", returnUrl: "https://x/return" });
  });
});
