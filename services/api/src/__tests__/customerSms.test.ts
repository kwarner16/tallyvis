import { afterEach, describe, expect, it, vi } from "vitest";
import type { Customer } from "@tallyvis/types";
import { useTestDb } from "./testHarness";
import { signUp } from "../services/auth";
import { createQuote, createQuotePublic, updateQuotePublic } from "../services/quotes";
import { recordJobOutcome } from "../services/jobOutcomes";
import {
  sendAppointmentConfirmationSms,
  sendAppointmentReminderSms,
  sendEstimateReadySms,
  sendOnTheWaySms,
  sendOptInConfirmationSms,
  sendPostServiceThankYouSms,
} from "../services/customerSms";

const getDb = useTestDb();

/**
 * V1 customer-facing SMS messaging program — covers the task's required
 * scenarios: eligible sends, no-consent/no-phone gating, opt-in-only-on-
 * genuinely-new-consent, message content/brand, the two implemented
 * triggers (createQuotePublic, recordJobOutcome's completion transition),
 * and provider-failure/duplicate-send handling. Follows the exact
 * `sendSms` spy convention `quoteSmsAlert.test.ts` already established —
 * these tests cover THIS package's own wiring/gating logic, never a real
 * Twilio HTTP call.
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

const publicSubmission = (customer: { name: string; email: string; phone?: string; smsConsent?: boolean }) => ({
  customer,
  property: { propertyType: "single-family" as const, stories: 1, address: "1 Test St" },
  servicePreferences,
  notes: "",
  photos: [],
  analysis,
});

async function setUp() {
  const db = getDb();
  const { session } = await signUp(db, {
    businessName: "Sparkle Windows",
    ownerEmail: "owner@sparkle.example",
    password: "correct-horse-battery",
  });
  return { db, session };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createQuotePublic — customer-facing opt-in + estimate-ready SMS wiring", () => {
  it("sends both opt-in confirmation and estimate-ready to an eligible, consenting customer", async () => {
    const { db, session } = await setUp();
    const sms = await import("../notifications/sms");
    const sendSmsSpy = vi.spyOn(sms, "sendSms").mockResolvedValue({ providerMessageId: "test-sid" });

    await createQuotePublic(
      db,
      session.businessId,
      publicSubmission({ name: "Jordan Rivera", email: "jordan@example.com", phone: "555-000-1111", smsConsent: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendSmsSpy).toHaveBeenCalledTimes(2);
    const calls = sendSmsSpy.mock.calls;
    const optIn = calls.find(([, kind]) => kind === "customer-opt-in-confirmation");
    const ready = calls.find(([, kind]) => kind === "customer-estimate-ready");
    expect(optIn).toBeDefined();
    expect(ready).toBeDefined();
    expect(optIn![0].to).toBe("+15550001111");
    expect(ready![0].to).toBe("+15550001111");
  });

  it("no consent -> neither customer-facing message sends", async () => {
    const { db, session } = await setUp();
    const sms = await import("../notifications/sms");
    const sendSmsSpy = vi.spyOn(sms, "sendSms").mockResolvedValue({ providerMessageId: "test-sid" });

    await createQuotePublic(
      db,
      session.businessId,
      publicSubmission({ name: "Jordan Rivera", email: "jordan@example.com", phone: "555-000-1111", smsConsent: false }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendSmsSpy).not.toHaveBeenCalled();
  });

  it("missing phone -> neither customer-facing message sends, even with consent checked", async () => {
    const { db, session } = await setUp();
    const sms = await import("../notifications/sms");
    const sendSmsSpy = vi.spyOn(sms, "sendSms").mockResolvedValue({ providerMessageId: "test-sid" });

    await createQuotePublic(
      db,
      session.businessId,
      publicSubmission({ name: "Jordan Rivera", email: "jordan@example.com", smsConsent: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendSmsSpy).not.toHaveBeenCalled();
  });

  it("re-analyzing an existing quote (updateQuotePublic) never resends the opt-in confirmation or estimate-ready message", async () => {
    const { db, session } = await setUp();
    const sms = await import("../notifications/sms");
    const sendSmsSpy = vi.spyOn(sms, "sendSms").mockResolvedValue({ providerMessageId: "test-sid" });

    const quote = await createQuotePublic(
      db,
      session.businessId,
      publicSubmission({ name: "Jordan Rivera", email: "jordan@example.com", phone: "555-000-1111", smsConsent: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendSmsSpy).toHaveBeenCalledTimes(2);

    await updateQuotePublic(
      db,
      session.businessId,
      quote.id,
      publicSubmission({ name: "Jordan Rivera", email: "jordan@example.com", phone: "555-000-1111", smsConsent: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendSmsSpy).toHaveBeenCalledTimes(2); // still just the original pair
  });

  it("a dashboard-created quote (createQuote, never grants consent) never triggers either customer-facing message", async () => {
    const { db, session } = await setUp();
    const sms = await import("../notifications/sms");
    const sendSmsSpy = vi.spyOn(sms, "sendSms").mockResolvedValue({ providerMessageId: "test-sid" });

    await createQuote(db, session, {
      ...publicSubmission({ name: "Jordan Rivera", email: "jordan@example.com", phone: "555-000-1111", smsConsent: true }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendSmsSpy).not.toHaveBeenCalled();
  });

  it("a rapid duplicate/retried submission for the same phone within the cooldown window does not double-send either message", async () => {
    const { db, session } = await setUp();
    const sms = await import("../notifications/sms");
    const sendSmsSpy = vi.spyOn(sms, "sendSms").mockResolvedValue({ providerMessageId: "test-sid" });

    await createQuotePublic(
      db,
      session.businessId,
      publicSubmission({ name: "Jordan Rivera", email: "jordan@example.com", phone: "555-000-1111", smsConsent: true }),
    );
    await createQuotePublic(
      db,
      session.businessId,
      publicSubmission({ name: "Jordan Rivera", email: "jordan2@example.com", phone: "555-000-1111", smsConsent: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendSmsSpy).toHaveBeenCalledTimes(2); // one opt-in + one estimate-ready, not four
  });

  it("an SMS provider failure never fails quote creation and never becomes an unhandled rejection", async () => {
    const { db, session } = await setUp();
    const sms = await import("../notifications/sms");
    vi.spyOn(sms, "sendSms").mockRejectedValue(new Error("Twilio is down"));

    const quote = await createQuotePublic(
      db,
      session.businessId,
      publicSubmission({ name: "Jordan Rivera", email: "jordan@example.com", phone: "555-000-1111", smsConsent: true }),
    );

    expect(quote.id).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

describe("recordJobOutcome — post-service thank-you SMS wiring", () => {
  async function setUpConsentingQuote() {
    const { db, session } = await setUp();
    const quote = await createQuotePublic(
      db,
      session.businessId,
      publicSubmission({ name: "Jordan Rivera", email: "jordan@example.com", phone: "555-000-1111", smsConsent: true }),
    );
    return { db, session, quote };
  }

  it("sends the thank-you SMS when an outcome newly transitions to completed", async () => {
    const { db, session, quote } = await setUpConsentingQuote();
    const sms = await import("../notifications/sms");
    const sendSmsSpy = vi.spyOn(sms, "sendSms").mockResolvedValue({ providerMessageId: "test-sid" });
    sendSmsSpy.mockClear(); // drop the create-time opt-in/estimate-ready calls

    await recordJobOutcome(db, session, quote.id, { status: "completed", notes: "" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendSmsSpy).toHaveBeenCalledTimes(1);
    const [message, kind] = sendSmsSpy.mock.calls[0]!;
    expect(kind).toBe("customer-post-service-thank-you");
    expect(message.to).toBe("+15550001111");
    expect(message.body).toContain("Tallyvis");
    expect(message.body).toContain("Thank you");
  });

  it("does not resend the thank-you SMS when an already-completed outcome is edited again", async () => {
    const { db, session, quote } = await setUpConsentingQuote();
    const sms = await import("../notifications/sms");
    const sendSmsSpy = vi.spyOn(sms, "sendSms").mockResolvedValue({ providerMessageId: "test-sid" });

    await recordJobOutcome(db, session, quote.id, { status: "completed", notes: "" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    sendSmsSpy.mockClear();

    await recordJobOutcome(db, session, quote.id, { status: "completed", notes: "Updated notes." });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendSmsSpy).not.toHaveBeenCalled();
  });

  it("does not send the thank-you SMS for an in_progress outcome", async () => {
    const { db, session, quote } = await setUpConsentingQuote();
    const sms = await import("../notifications/sms");
    const sendSmsSpy = vi.spyOn(sms, "sendSms").mockResolvedValue({ providerMessageId: "test-sid" });
    sendSmsSpy.mockClear();

    await recordJobOutcome(db, session, quote.id, { status: "in_progress", notes: "" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendSmsSpy).not.toHaveBeenCalled();
  });

  it("does not send the thank-you SMS when the customer never consented", async () => {
    const { db, session } = await setUp();
    const quote = await createQuote(db, session, {
      ...publicSubmission({ name: "Jordan Rivera", email: "jordan@example.com", phone: "555-000-1111" }),
    });
    const sms = await import("../notifications/sms");
    const sendSmsSpy = vi.spyOn(sms, "sendSms").mockResolvedValue({ providerMessageId: "test-sid" });

    await recordJobOutcome(db, session, quote.id, { status: "completed", notes: "" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendSmsSpy).not.toHaveBeenCalled();
  });
});

describe("unwired message senders — direct unit coverage of content, brand, and gating", () => {
  function fakeCustomer(overrides: Partial<Customer> = {}): Customer {
    return {
      id: "cust_1",
      businessId: "biz_1",
      name: "Jordan Rivera",
      email: "jordan@example.com",
      phone: "+15550001111",
      createdAt: "",
      updatedAt: "",
      smsConsent: true,
      ...overrides,
    };
  }

  it("sendAppointmentConfirmationSms sends branded content with the real dynamic date/time, no link or embedded phone number", async () => {
    const sms = await import("../notifications/sms");
    const sendSmsSpy = vi.spyOn(sms, "sendSms").mockResolvedValue({ providerMessageId: "x" });

    const result = sendAppointmentConfirmationSms(fakeCustomer(), { date: "Oct 14", time: "2:00 PM" });
    expect(result).not.toBeNull();
    await result!.finished;

    const [message, kind] = sendSmsSpy.mock.calls[0]!;
    expect(kind).toBe("customer-appointment-confirmation");
    expect(message.body.startsWith("Tallyvis:")).toBe(true);
    expect(message.body).toContain("Oct 14");
    expect(message.body).toContain("2:00 PM");
    expect(message.body).not.toMatch(/https?:\/\//);
    expect(message.body).not.toMatch(/\(\d{3}\)|\d{3}-\d{3}-\d{4}/);
  });

  it("sendAppointmentReminderSms sends branded content with the real dynamic date/time", async () => {
    const sms = await import("../notifications/sms");
    const sendSmsSpy = vi.spyOn(sms, "sendSms").mockResolvedValue({ providerMessageId: "x" });

    const result = sendAppointmentReminderSms(fakeCustomer(), { date: "Oct 14", time: "2:00 PM" });
    await result!.finished;

    const [message, kind] = sendSmsSpy.mock.calls[0]!;
    expect(kind).toBe("customer-appointment-reminder");
    expect(message.body.startsWith("Tallyvis:")).toBe(true);
    expect(message.body).toContain("Reminder");
    expect(message.body).toContain("Oct 14");
  });

  it("sendOnTheWaySms sends branded content with the real ETA", async () => {
    const sms = await import("../notifications/sms");
    const sendSmsSpy = vi.spyOn(sms, "sendSms").mockResolvedValue({ providerMessageId: "x" });

    const result = sendOnTheWaySms(fakeCustomer(), 15);
    await result!.finished;

    const [message, kind] = sendSmsSpy.mock.calls[0]!;
    expect(kind).toBe("customer-on-the-way");
    expect(message.body.startsWith("Tallyvis:")).toBe(true);
    expect(message.body).toContain("15 minutes");
  });

  it("every sender returns null (sends nothing) for a non-consenting customer", async () => {
    const sms = await import("../notifications/sms");
    const sendSmsSpy = vi.spyOn(sms, "sendSms").mockResolvedValue({ providerMessageId: "x" });
    const notConsenting = fakeCustomer({ smsConsent: false });

    expect(sendOptInConfirmationSms(notConsenting)).toBeNull();
    expect(sendEstimateReadySms(notConsenting)).toBeNull();
    expect(sendAppointmentConfirmationSms(notConsenting, { date: "Oct 14", time: "2 PM" })).toBeNull();
    expect(sendAppointmentReminderSms(notConsenting, { date: "Oct 14", time: "2 PM" })).toBeNull();
    expect(sendOnTheWaySms(notConsenting, 10)).toBeNull();
    expect(sendPostServiceThankYouSms(notConsenting)).toBeNull();
    expect(sendSmsSpy).not.toHaveBeenCalled();
  });

  it("every sender returns null (sends nothing) for a consenting customer with no phone", async () => {
    const sms = await import("../notifications/sms");
    const sendSmsSpy = vi.spyOn(sms, "sendSms").mockResolvedValue({ providerMessageId: "x" });
    const noPhone = fakeCustomer({ phone: undefined });

    expect(sendOptInConfirmationSms(noPhone)).toBeNull();
    expect(sendEstimateReadySms(noPhone)).toBeNull();
    expect(sendPostServiceThankYouSms(noPhone)).toBeNull();
    expect(sendSmsSpy).not.toHaveBeenCalled();
  });

  it("never sends when the stored phone is somehow unparseable", async () => {
    const sms = await import("../notifications/sms");
    const sendSmsSpy = vi.spyOn(sms, "sendSms").mockResolvedValue({ providerMessageId: "x" });

    expect(sendEstimateReadySms(fakeCustomer({ phone: "not-a-phone-number" }))).toBeNull();
    expect(sendSmsSpy).not.toHaveBeenCalled();
  });
});
