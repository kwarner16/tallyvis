import { afterEach, describe, expect, it } from "vitest";
import { sendSms, isUsingDevSmsProvider } from "../notifications/sms";
import { NotificationError } from "../notifications/types";

/**
 * Pre-launch audit (2026-10 — see docs/decisions/0033-pre-launch-audit.md):
 * TallyVis's Twilio A2P 10DLC campaign is not yet approved, so a real send
 * must stay refused even when `SMS_PROVIDER=twilio` and valid-looking
 * Twilio credentials are configured (e.g. while Kyle sets up Twilio
 * Console/webhook testing ahead of approval) — `SMS_A2P_APPROVED` is the
 * dedicated, explicit gate for that. Every other SMS test in this package
 * mocks `sendSms` directly and never exercises `resolveSmsProvider()`
 * itself; this file is the one place that does.
 */

const ENV_KEYS = [
  "SMS_PROVIDER",
  "SMS_A2P_APPROVED",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_MESSAGING_SERVICE_SID",
  "TWILIO_FROM_NUMBER",
] as const;

function clearSmsEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key];
}

afterEach(() => {
  clearSmsEnv();
});

describe("SMS_A2P_APPROVED gate", () => {
  it("refuses to send through Twilio when SMS_A2P_APPROVED is unset, even with full valid-looking credentials", async () => {
    clearSmsEnv();
    process.env.SMS_PROVIDER = "twilio";
    process.env.TWILIO_ACCOUNT_SID = "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    process.env.TWILIO_AUTH_TOKEN = "test_auth_token";
    process.env.TWILIO_MESSAGING_SERVICE_SID = "MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";

    await expect(sendSms({ to: "+15550001234", body: "test" }, "test-kind")).rejects.toThrow(
      /A2P 10DLC campaign approval/,
    );
  });

  it("refuses when SMS_A2P_APPROVED is any value other than the literal string \"true\"", async () => {
    clearSmsEnv();
    process.env.SMS_PROVIDER = "twilio";
    process.env.SMS_A2P_APPROVED = "1";
    process.env.TWILIO_ACCOUNT_SID = "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    process.env.TWILIO_AUTH_TOKEN = "test_auth_token";
    process.env.TWILIO_FROM_NUMBER = "+15559998888";

    await expect(sendSms({ to: "+15550001234", body: "test" }, "test-kind")).rejects.toThrow(NotificationError);
  });

  it("still fails fast on missing Twilio credentials even once SMS_A2P_APPROVED=true (gate order doesn't mask the real config error)", async () => {
    clearSmsEnv();
    process.env.SMS_PROVIDER = "twilio";
    process.env.SMS_A2P_APPROVED = "true";
    // Deliberately no TWILIO_* vars set at all.

    await expect(sendSms({ to: "+15550001234", body: "test" }, "test-kind")).rejects.toThrow(
      /TWILIO_ACCOUNT_SID/,
    );
  });

  it("the dev provider never requires SMS_A2P_APPROVED at all", async () => {
    clearSmsEnv(); // SMS_PROVIDER unset -> defaults to "dev"
    await expect(sendSms({ to: "+15550001234", body: "test" }, "test-kind")).resolves.toBeDefined();
  });

  describe("isUsingDevSmsProvider", () => {
    it("true when SMS_PROVIDER is unset/dev", () => {
      clearSmsEnv();
      expect(isUsingDevSmsProvider()).toBe(true);
    });

    it("true when SMS_PROVIDER=twilio but SMS_A2P_APPROVED is not \"true\"", () => {
      clearSmsEnv();
      process.env.SMS_PROVIDER = "twilio";
      expect(isUsingDevSmsProvider()).toBe(true);
    });

    it("false only once SMS_PROVIDER=twilio AND SMS_A2P_APPROVED=true", () => {
      clearSmsEnv();
      process.env.SMS_PROVIDER = "twilio";
      process.env.SMS_A2P_APPROVED = "true";
      expect(isUsingDevSmsProvider()).toBe(false);
    });
  });
});
