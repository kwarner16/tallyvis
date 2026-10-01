import { afterEach, describe, expect, it, vi } from "vitest";
import type { Customer } from "@tallyvis/types";
import { useTestDb } from "./testHarness";
import { signUp } from "../services/auth";
import { createQuote, createQuotePublic, updateQuotePublic, updateQuoteStatus } from "../services/quotes";
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

/**
 * `customerSms.ts`'s `dispatch()` throttles repeat sends per `kind:phone`
 * at module scope (see that file's own comment) — deliberately, so a real
 * retried request can't double-text a customer. That state is NOT reset
 * between tests in this file (same as `quoteSmsAlert.test.ts`'s own
 * cooldown relies on each test standing up a fresh business/number to
 * avoid collisions). Every independent test below that expects a send to
 * actually go through therefore needs its OWN phone number, distinct from
 * every other test in this file — reusing one (as an earlier version of
 * this file did) makes a later test's "fresh" customer silently inherit an
 * earlier test's cooldown and observe zero sends. The one deliberate
 * exception is a test whose entire point IS exercising that same cooldown
 * within itself (see the "rapid duplicate" test below), which still needs
 * a number no OTHER test touches.
 */
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

describe("createQuotePublic — opt-in confirmation SMS wiring (estimate-ready no longer fires here)", () => {
  it("sends the opt-in confirmation, and ONLY the opt-in confirmation, to an eligible, consenting customer", async () => {
    const { db, session } = await setUp();
    const sms = await import("../notifications/sms");
    const sendSmsSpy = vi.spyOn(sms, "sendSms").mockResolvedValue({ providerMessageId: "test-sid" });

    await createQuotePublic(
      db,
      session.businessId,
      publicSubmission({ name: "Jordan Rivera", email: "jordan@example.com", phone: "555-000-1111", smsConsent: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    // 2026-10 correction: the estimate-ready SMS previously fired here too
    // (immediately on submission, before any business review), which did
    // not match the intended V1 trigger — it now only fires from
    // `updateQuoteStatus`'s transition into "approved" (see that describe
    // block below). A bare submission must send the opt-in confirmation
    // and NOTHING else.
    expect(sendSmsSpy).toHaveBeenCalledTimes(1);
    const [message, kind] = sendSmsSpy.mock.calls[0]!;
    expect(kind).toBe("customer-opt-in-confirmation");
    expect(message.to).toBe("+15550001111");
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

  it("re-analyzing an existing quote (updateQuotePublic) never resends the opt-in confirmation", async () => {
    const { db, session } = await setUp();
    const sms = await import("../notifications/sms");
    const sendSmsSpy = vi.spyOn(sms, "sendSms").mockResolvedValue({ providerMessageId: "test-sid" });

    const quote = await createQuotePublic(
      db,
      session.businessId,
      publicSubmission({ name: "Jordan Rivera", email: "jordan@example.com", phone: "555-000-2222", smsConsent: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendSmsSpy).toHaveBeenCalledTimes(1);

    await updateQuotePublic(
      db,
      session.businessId,
      quote.id,
      publicSubmission({ name: "Jordan Rivera", email: "jordan@example.com", phone: "555-000-2222", smsConsent: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendSmsSpy).toHaveBeenCalledTimes(1); // still just the original opt-in confirmation
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

    // Deliberately the SAME phone number for both calls below — that's the
    // one case in this file where reuse is the point (see this file's own
    // "distinct phone per independent test" note above `setUp`). Must still
    // be a number no OTHER test in this file touches, or an earlier test's
    // own cooldown entry would make this test's very first call a false
    // positive for "the cooldown worked" instead of a real one.
    await createQuotePublic(
      db,
      session.businessId,
      publicSubmission({ name: "Jordan Rivera", email: "jordan@example.com", phone: "555-000-3333", smsConsent: true }),
    );
    await createQuotePublic(
      db,
      session.businessId,
      publicSubmission({ name: "Jordan Rivera", email: "jordan2@example.com", phone: "555-000-3333", smsConsent: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendSmsSpy).toHaveBeenCalledTimes(1); // one opt-in confirmation, not two
  });

  it("an SMS provider failure never fails quote creation and never becomes an unhandled rejection", async () => {
    const { db, session } = await setUp();
    const sms = await import("../notifications/sms");
    vi.spyOn(sms, "sendSms").mockRejectedValue(new Error("Twilio is down"));

    const quote = await createQuotePublic(
      db,
      session.businessId,
      publicSubmission({ name: "Jordan Rivera", email: "jordan@example.com", phone: "555-000-4444", smsConsent: true }),
    );

    expect(quote.id).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

describe("updateQuoteStatus — estimate-ready SMS fires only on the business's own approval", () => {
  async function setUpConsentingQuote(phone: string) {
    const { db, session } = await setUp();
    const quote = await createQuotePublic(
      db,
      session.businessId,
      publicSubmission({ name: "Jordan Rivera", email: "jordan@example.com", phone, smsConsent: true }),
    );
    return { db, session, quote };
  }

  it("submitting a quote alone never sends the estimate-ready SMS, even though it sends the opt-in confirmation", async () => {
    const { db, session } = await setUp();
    const sms = await import("../notifications/sms");
    const sendSmsSpy = vi.spyOn(sms, "sendSms").mockResolvedValue({ providerMessageId: "test-sid" });

    const quote = await createQuotePublic(
      db,
      session.businessId,
      publicSubmission({ name: "Jordan Rivera", email: "jordan@example.com", phone: "555-000-7001", smsConsent: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(quote.status).toBe("new"); // not yet approved by the business
    expect(sendSmsSpy.mock.calls.find(([, kind]) => kind === "customer-estimate-ready")).toBeUndefined();
    expect(sendSmsSpy.mock.calls.find(([, kind]) => kind === "customer-opt-in-confirmation")).toBeDefined();
  });

  it("the business approving the quote (new -> approved) sends exactly one estimate-ready SMS", async () => {
    const { db, session, quote } = await setUpConsentingQuote("555-000-7002");
    const sms = await import("../notifications/sms");
    const sendSmsSpy = vi.spyOn(sms, "sendSms").mockResolvedValue({ providerMessageId: "test-sid" });
    sendSmsSpy.mockClear(); // drop the create-time opt-in confirmation call

    await updateQuoteStatus(db, session, quote.id, "approved");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendSmsSpy).toHaveBeenCalledTimes(1);
    const [message, kind] = sendSmsSpy.mock.calls[0]!;
    expect(kind).toBe("customer-estimate-ready");
    expect(message.to).toBe("+15550007002");
    expect(message.body).toContain("TallyVis");
    expect(message.body).toContain("approved");
    expect(message.body).toMatch(/email/i);
    expect(message.body).not.toMatch(/https?:\/\//);
    expect(message.body).not.toMatch(/\(\d{3}\)|\d{3}-\d{3}-\d{4}/);
  });

  it("approving via needs_review -> approved also sends the estimate-ready SMS", async () => {
    const { db, session, quote } = await setUpConsentingQuote("555-000-7003");
    await updateQuoteStatus(db, session, quote.id, "needs_review");
    const sms = await import("../notifications/sms");
    const sendSmsSpy = vi.spyOn(sms, "sendSms").mockResolvedValue({ providerMessageId: "test-sid" });
    sendSmsSpy.mockClear();

    await updateQuoteStatus(db, session, quote.id, "approved");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendSmsSpy).toHaveBeenCalledTimes(1);
    expect(sendSmsSpy.mock.calls[0]![1]).toBe("customer-estimate-ready");
  });

  it("re-approving (or any later transition) never re-sends the estimate-ready SMS a second time", async () => {
    const { db, session, quote } = await setUpConsentingQuote("555-000-7004");
    await updateQuoteStatus(db, session, quote.id, "approved");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const sms = await import("../notifications/sms");
    const sendSmsSpy = vi.spyOn(sms, "sendSms").mockResolvedValue({ providerMessageId: "test-sid" });
    sendSmsSpy.mockClear();

    // The transition graph itself already refuses "approved" -> "approved"
    // — re-running the exact same approval call must fail, not silently
    // re-send.
    await expect(updateQuoteStatus(db, session, quote.id, "approved")).rejects.toThrow(
      /Cannot move a quote from "approved" to "approved"/,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendSmsSpy).not.toHaveBeenCalled();

    // A legitimate further transition (approved -> sent) must not re-fire
    // the estimate-ready SMS either — that message is specifically about
    // the approval event, not every subsequent status change.
    await updateQuoteStatus(db, session, quote.id, "sent");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendSmsSpy).not.toHaveBeenCalled();
  });

  it("does not send the estimate-ready SMS when the customer never consented", async () => {
    const { db, session } = await setUp();
    const quote = await createQuote(db, session, {
      ...publicSubmission({ name: "Jordan Rivera", email: "jordan@example.com", phone: "555-000-7005" }),
    });
    const sms = await import("../notifications/sms");
    const sendSmsSpy = vi.spyOn(sms, "sendSms").mockResolvedValue({ providerMessageId: "test-sid" });

    await updateQuoteStatus(db, session, quote.id, "approved");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendSmsSpy).not.toHaveBeenCalled();
  });
});

describe("recordJobOutcome — post-service thank-you SMS wiring", () => {
  async function setUpConsentingQuote() {
    const { db, session } = await setUp();
    const quote = await createQuotePublic(
      db,
      session.businessId,
      publicSubmission({ name: "Jordan Rivera", email: "jordan@example.com", phone: "555-000-5555", smsConsent: true }),
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
    expect(message.to).toBe("+15550005555");
    expect(message.body).toContain("TallyVis");
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
      ...publicSubmission({ name: "Jordan Rivera", email: "jordan@example.com", phone: "555-000-6666" }),
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
    expect(message.body.startsWith("TallyVis:")).toBe(true);
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
    expect(message.body.startsWith("TallyVis:")).toBe(true);
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
    expect(message.body.startsWith("TallyVis:")).toBe(true);
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
