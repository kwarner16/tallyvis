import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "./testHarness";
import { signUp } from "../services/auth";
import { updateSmsNotificationSettings } from "../services/business";
import { createQuotePublic, updateQuotePublic } from "../services/quotes";
import { sendNewQuoteSmsAlert } from "../services/quoteSmsAlert";
import type { Business, Quote } from "@tallyvis/types";

const getDb = useTestDb();

/**
 * Phase 15 (see docs/decisions/0028-mobile-sms-embed-and-growth-updates.md)
 * — the new-quote SMS alert. `sendSms` (the actual provider call) is always
 * spied/mocked here, the same convention `quoteEmail.test.ts` already
 * established for `sendEmail` — these tests cover THIS package's own
 * wiring/gating logic, never a real Twilio HTTP call.
 */

const analysis = {
  characteristics: {
    vertical: "window-cleaning" as const,
    windowCount: 15,
    windowType: "double-hung" as const,
    paneCount: 0,
    stories: 1,
    screens: 4,
    tracks: 4,
    accessibility: "easy" as const,
    condition: "good" as const,
    hardWaterStaining: false,
    estimatedLaborHours: 1.5,
    interiorCleaning: false,
  },
  metadata: { confidence: "high" as const },
};

const servicePreferences = {
  interiorCleaning: false,
  screens: true,
  tracks: true,
  hardWaterTreatment: "unsure" as const,
};

const publicSubmission = (customer: { name: string; email: string; phone?: string }) => ({
  customer,
  property: { propertyType: "single-family" as const, stories: 1, address: "1 Test St" },
  servicePreferences,
  notes: "",
  photos: [],
  analysis,
});

const buildQuoteUrl = (quoteId: string) => `https://app.example.com/dashboard/quotes/${quoteId}`;

async function setUpEnabledBusiness() {
  const db = getDb();
  const { session } = await signUp(db, {
    businessName: "Sparkle Windows",
    ownerEmail: "owner@sparkle.example",
    password: "correct-horse-battery",
  });
  await updateSmsNotificationSettings(db, session, { enabled: true, notificationPhone: "5551234567" });
  return { db, session };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createQuotePublic — new-quote SMS alert wiring", () => {
  it("sends an alert to the business's own notification number when enabled", async () => {
    const { db, session } = await setUpEnabledBusiness();
    const sms = await import("../notifications/sms");
    const sendSmsSpy = vi.spyOn(sms, "sendSms").mockResolvedValue({ providerMessageId: "test-sid" });

    await createQuotePublic(
      db,
      session.businessId,
      publicSubmission({ name: "Jordan Rivera", email: "jordan@example.com", phone: "555-000-1111" }),
      buildQuoteUrl,
      (finished) => finished, // no Next `after()` in a test — just let it resolve
    );
    await new Promise((resolve) => setTimeout(resolve, 0)); // let the fire-and-forget send settle

    expect(sendSmsSpy).toHaveBeenCalledTimes(1);
    const [message, kind] = sendSmsSpy.mock.calls[0]!;
    expect(message.to).toBe("+15551234567"); // the BUSINESS's own number, never the customer's
    expect(message.body).toContain("Jordan Rivera");
    expect(message.body).toContain("1 Test St");
    expect(message.body).toContain("555-000-1111"); // customer's phone included as a convenience callback number
    expect(message.body).toContain("/dashboard/quotes/");
    expect(kind).toBe("new-quote-alert");
  });

  it("never sends for a second tenant's quote, and never uses the other tenant's number", async () => {
    const db = getDb();
    const a = await signUp(db, { businessName: "A Windows", ownerEmail: "a@example.com", password: "correct-horse-battery" });
    const b = await signUp(db, { businessName: "B Windows", ownerEmail: "b@example.com", password: "correct-horse-battery" });
    await updateSmsNotificationSettings(db, a.session, { enabled: true, notificationPhone: "5551111111" });
    await updateSmsNotificationSettings(db, b.session, { enabled: true, notificationPhone: "5552222222" });

    const sms = await import("../notifications/sms");
    const sendSmsSpy = vi.spyOn(sms, "sendSms").mockResolvedValue({ providerMessageId: "test-sid" });

    await createQuotePublic(
      db,
      a.session.businessId,
      publicSubmission({ name: "Customer A", email: "customera@example.com" }),
      buildQuoteUrl,
      (finished) => finished,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendSmsSpy).toHaveBeenCalledTimes(1);
    expect(sendSmsSpy.mock.calls[0]![0].to).toBe("+15551111111");
    expect(sendSmsSpy.mock.calls[0]![0].to).not.toBe("+15552222222");
  });

  it("sends nothing when SMS notifications are disabled", async () => {
    const db = getDb();
    const { session } = await signUp(db, {
      businessName: "Sparkle Windows",
      ownerEmail: "owner@sparkle.example",
      password: "correct-horse-battery",
    });
    // Notifications left at their safe default (disabled, no number).
    const sms = await import("../notifications/sms");
    const sendSmsSpy = vi.spyOn(sms, "sendSms").mockResolvedValue({ providerMessageId: "test-sid" });

    await createQuotePublic(
      db,
      session.businessId,
      publicSubmission({ name: "Jordan Rivera", email: "jordan@example.com" }),
      buildQuoteUrl,
      (finished) => finished,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendSmsSpy).not.toHaveBeenCalled();
  });

  it("an SMS provider failure never fails quote creation", async () => {
    const { db, session } = await setUpEnabledBusiness();
    const sms = await import("../notifications/sms");
    vi.spyOn(sms, "sendSms").mockRejectedValue(new Error("Twilio is down"));

    const quote = await createQuotePublic(
      db,
      session.businessId,
      publicSubmission({ name: "Jordan Rivera", email: "jordan@example.com" }),
      buildQuoteUrl,
      (finished) => finished,
    );

    expect(quote.id).toBeTruthy();
    // The background rejection must not become an unhandled rejection either.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("re-analyzing an existing quote (updateQuotePublic) never sends a second alert", async () => {
    const { db, session } = await setUpEnabledBusiness();
    const sms = await import("../notifications/sms");
    const sendSmsSpy = vi.spyOn(sms, "sendSms").mockResolvedValue({ providerMessageId: "test-sid" });

    const quote = await createQuotePublic(
      db,
      session.businessId,
      publicSubmission({ name: "Jordan Rivera", email: "jordan@example.com" }),
      buildQuoteUrl,
      (finished) => finished,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendSmsSpy).toHaveBeenCalledTimes(1);

    await updateQuotePublic(
      db,
      session.businessId,
      quote.id,
      publicSubmission({ name: "Jordan Rivera", email: "jordan@example.com" }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendSmsSpy).toHaveBeenCalledTimes(1); // still just the one, from the original create
  });

  it("does not send a second alert for a rapid duplicate/retried create within the cooldown window", async () => {
    const { db, session } = await setUpEnabledBusiness();
    const sms = await import("../notifications/sms");
    const sendSmsSpy = vi.spyOn(sms, "sendSms").mockResolvedValue({ providerMessageId: "test-sid" });

    await createQuotePublic(
      db,
      session.businessId,
      publicSubmission({ name: "Jordan Rivera", email: "jordan@example.com" }),
      buildQuoteUrl,
      (finished) => finished,
    );
    await createQuotePublic(
      db,
      session.businessId,
      publicSubmission({ name: "Jordan Rivera", email: "jordan@example.com" }),
      buildQuoteUrl,
      (finished) => finished,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendSmsSpy).toHaveBeenCalledTimes(1);
  });

  it("omitting buildQuoteUrl (every existing caller that doesn't care about SMS) sends nothing and changes no other behavior", async () => {
    const { db, session } = await setUpEnabledBusiness();
    const sms = await import("../notifications/sms");
    const sendSmsSpy = vi.spyOn(sms, "sendSms").mockResolvedValue({ providerMessageId: "test-sid" });

    const quote = await createQuotePublic(
      db,
      session.businessId,
      publicSubmission({ name: "Jordan Rivera", email: "jordan@example.com" }),
    );

    expect(quote.id).toBeTruthy();
    expect(sendSmsSpy).not.toHaveBeenCalled();
  });
});

describe("sendNewQuoteSmsAlert — direct unit coverage of the gating logic", () => {
  function fakeQuote(overrides: Partial<Quote> = {}): Quote {
    return {
      id: "quote_1",
      businessId: "biz_1",
      customerId: "cust_1",
      customer: {
        id: "cust_1",
        businessId: "biz_1",
        name: "Jordan Rivera",
        email: "jordan@example.com",
        createdAt: "",
        updatedAt: "",
        smsConsent: false,
      },
      property: { propertyType: "single-family", stories: 1, address: "1 Test St" },
      servicePreferences,
      notes: "",
      photos: [],
      analysis,
      estimate: { lineItems: [], subtotal: 184, total: 184, currency: "USD", confidence: "high" },
      pricingConfigId: "config_1",
      status: "new",
      createdAt: "",
      updatedAt: "",
      ...overrides,
    };
  }

  function fakeBusiness(overrides: Partial<Business> = {}): Business {
    return {
      id: "biz_1",
      name: "Sparkle Windows",
      email: "owner@sparkle.example",
      phone: "",
      serviceArea: "",
      defaultIndustry: "window-cleaning",
      createdAt: "",
      publicEmbedId: "embed_1",
      needsOnboarding: false,
      smsNotificationsEnabled: false,
      ...overrides,
    };
  }

  it("never sends when a stored notification phone is somehow unparseable", async () => {
    const sms = await import("../notifications/sms");
    const sendSmsSpy = vi.spyOn(sms, "sendSms").mockResolvedValue({ providerMessageId: "x" });

    const { finished } = sendNewQuoteSmsAlert(
      fakeBusiness({ smsNotificationsEnabled: true, notificationPhone: "not-a-phone-number" }),
      fakeQuote(),
      buildQuoteUrl,
    );
    await finished;

    expect(sendSmsSpy).not.toHaveBeenCalled();
  });

  it("never sends when enabled but no notification phone is on file at all", async () => {
    const sms = await import("../notifications/sms");
    const sendSmsSpy = vi.spyOn(sms, "sendSms").mockResolvedValue({ providerMessageId: "x" });

    const { finished } = sendNewQuoteSmsAlert(
      fakeBusiness({ smsNotificationsEnabled: true, notificationPhone: undefined }),
      fakeQuote(),
      buildQuoteUrl,
    );
    await finished;

    expect(sendSmsSpy).not.toHaveBeenCalled();
  });
});
