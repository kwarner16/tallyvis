import { devSmsProvider } from "./providers/dev";
import { createTwilioProvider } from "./providers/twilio";
import { logNotificationEvent, maskPhone } from "../logging";
import { NotificationError } from "../types";
import type { SmsMessage, SmsProvider } from "./types";

export { type SmsMessage, type SmsProvider } from "./types";

/**
 * Phase 15 (see docs/decisions/0028-mobile-sms-embed-and-growth-updates.md)
 * — the SMS provider abstraction, mirroring `../index.ts`'s
 * `resolveEmailProvider`/`sendEmail` exactly. This file is the only place
 * `SMS_PROVIDER`/`TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_FROM_NUMBER`
 * are read — every caller only ever calls `sendSms()` below, never a
 * provider directly.
 */
function resolveSmsProvider(): SmsProvider {
  const selected = process.env.SMS_PROVIDER?.trim() || "dev";
  if (selected === "dev") return devSmsProvider;
  if (selected === "twilio") {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_FROM_NUMBER;
    if (!accountSid || !authToken || !fromNumber) {
      throw new NotificationError(
        "SMS is not configured for this environment (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM_NUMBER missing).",
        "not-configured",
      );
    }
    return createTwilioProvider({ accountSid, authToken, fromNumber });
  }
  throw new NotificationError(`Unknown SMS_PROVIDER "${selected}". Expected "dev" or "twilio".`, "not-configured");
}

/**
 * The one function every caller in this package uses to send a text message
 * — resolves the configured provider, sends, and logs one structured line
 * either way. `kind` is a short label ("new-quote-alert") for the log line
 * only, never the message body itself.
 */
export async function sendSms(message: SmsMessage, kind: string): Promise<{ providerMessageId?: string }> {
  const startedAt = Date.now();
  let provider: SmsProvider;
  try {
    provider = resolveSmsProvider();
  } catch (err) {
    logNotificationEvent({
      channel: "sms",
      provider: "unresolved",
      kind,
      success: false,
      latencyMs: Date.now() - startedAt,
      recipientMasked: maskPhone(message.to),
      errorCategory: err instanceof NotificationError ? err.category : "unknown",
    });
    throw err;
  }

  try {
    const result = await provider.send(message);
    logNotificationEvent({
      channel: "sms",
      provider: provider.name,
      kind,
      success: true,
      latencyMs: Date.now() - startedAt,
      recipientMasked: maskPhone(message.to),
    });
    return result;
  } catch (err) {
    const wrapped =
      err instanceof NotificationError
        ? err
        : new NotificationError(err instanceof Error ? err.message : `The "${provider.name}" SMS provider failed.`, "unknown");
    logNotificationEvent({
      channel: "sms",
      provider: provider.name,
      kind,
      success: false,
      latencyMs: Date.now() - startedAt,
      recipientMasked: maskPhone(message.to),
      errorCategory: wrapped.category,
    });
    throw wrapped;
  }
}

/** Whether SMS is currently the dev/console-log provider rather than a real one — same reasoning as `isUsingDevEmailProvider`. */
export function isUsingDevSmsProvider(): boolean {
  return (process.env.SMS_PROVIDER?.trim() || "dev") !== "twilio";
}
