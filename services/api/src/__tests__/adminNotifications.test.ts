import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notifyAdminOfNewSignup } from "../services/adminNotifications";
import { sendEmail } from "../notifications";
import { sendSms } from "../notifications/sms";
import type { Business } from "@tallyvis/types";

vi.mock("../notifications", () => ({ sendEmail: vi.fn() }));
vi.mock("../notifications/sms", () => ({ sendSms: vi.fn() }));

const sampleBusiness = (overrides: Partial<Business> = {}): Business => ({
  id: "biz_123",
  name: "Sparkle Windows",
  email: "owner@sparkle.example",
  phone: "",
  serviceArea: "",
  defaultIndustry: "window-cleaning",
  createdAt: "2026-10-01T00:00:00.000Z",
  publicEmbedId: "embed_abc",
  needsOnboarding: false,
  smsNotificationsEnabled: false,
  ...overrides,
});

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.mocked(sendEmail).mockResolvedValue({});
  vi.mocked(sendSms).mockResolvedValue({});
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.clearAllMocks();
});

describe("notifyAdminOfNewSignup", () => {
  it("sends the admin email with business name, owner email, method, and no fabricated plan/trial status, when ADMIN_NOTIFICATION_EMAIL is set", async () => {
    process.env.ADMIN_NOTIFICATION_EMAIL = "kyle@tallyvis.com";
    const { finished } = notifyAdminOfNewSignup(sampleBusiness(), "password", (id) => `https://app.tallyvis.com/admin/businesses/${id}`);
    await finished;

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [message] = vi.mocked(sendEmail).mock.calls[0]!;
    expect(message.to).toBe("kyle@tallyvis.com");
    expect(message.subject).toBe("New TallyVis signup — Sparkle Windows");
    expect(message.text).toContain("Sparkle Windows");
    expect(message.text).toContain("owner@sparkle.example");
    expect(message.text).toContain("Email/password");
    expect(message.text).toContain("not yet selected");
    expect(message.text).toContain("https://app.tallyvis.com/admin/businesses/biz_123");
  });

  it("labels a Google signup correctly", async () => {
    process.env.ADMIN_NOTIFICATION_EMAIL = "kyle@tallyvis.com";
    const { finished } = notifyAdminOfNewSignup(sampleBusiness(), "google");
    await finished;

    const [message] = vi.mocked(sendEmail).mock.calls[0]!;
    expect(message.text).toContain("Google");
  });

  it("skips the email entirely (no send attempted) when ADMIN_NOTIFICATION_EMAIL is unset", async () => {
    delete process.env.ADMIN_NOTIFICATION_EMAIL;
    const { finished } = notifyAdminOfNewSignup(sampleBusiness(), "password");
    await finished;
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("never fails (never rejects `finished`) even when the email provider throws", async () => {
    process.env.ADMIN_NOTIFICATION_EMAIL = "kyle@tallyvis.com";
    vi.mocked(sendEmail).mockRejectedValue(new Error("provider down"));
    const { finished } = notifyAdminOfNewSignup(sampleBusiness(), "password");
    await expect(finished).resolves.toBeUndefined();
  });

  it("does not send SMS when ADMIN_SIGNUP_SMS_ENABLED is unset, even with a phone configured", async () => {
    process.env.ADMIN_NOTIFICATION_PHONE = "+15555550123";
    const { finished } = notifyAdminOfNewSignup(sampleBusiness(), "password");
    await finished;
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("does not send SMS when enabled but no phone is configured", async () => {
    process.env.ADMIN_SIGNUP_SMS_ENABLED = "true";
    delete process.env.ADMIN_NOTIFICATION_PHONE;
    const { finished } = notifyAdminOfNewSignup(sampleBusiness(), "password");
    await finished;
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("sends a concise admin SMS — never the customer's number, never gated on any customer SMS consent — when both are configured", async () => {
    process.env.ADMIN_SIGNUP_SMS_ENABLED = "true";
    process.env.ADMIN_NOTIFICATION_PHONE = "+15555550123";
    const { finished } = notifyAdminOfNewSignup(sampleBusiness(), "password");
    await finished;

    expect(sendSms).toHaveBeenCalledTimes(1);
    const [message] = vi.mocked(sendSms).mock.calls[0]!;
    expect(message.to).toBe("+15555550123");
    expect(message.body).toContain("Sparkle Windows");
  });

  it("never fails (never rejects `finished`) even when the SMS provider throws", async () => {
    process.env.ADMIN_SIGNUP_SMS_ENABLED = "true";
    process.env.ADMIN_NOTIFICATION_PHONE = "+15555550123";
    vi.mocked(sendSms).mockRejectedValue(new Error("twilio down"));
    const { finished } = notifyAdminOfNewSignup(sampleBusiness(), "password");
    await expect(finished).resolves.toBeUndefined();
  });
});
