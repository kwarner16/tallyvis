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
 * `SMS_PROVIDER`/`TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/
 * `TWILIO_MESSAGING_SERVICE_SID`/`TWILIO_FROM_NUMBER`/`SMS_A2P_APPROVED` are
 * read — every caller only ever calls `sendSms()` below, never a provider
 * directly.
 *
 * `TWILIO_MESSAGING_SERVICE_SID` is preferred over `TWILIO_FROM_NUMBER`
 * when both are set — see `providers/twilio.ts`'s own comment: sending
 * through a Messaging Service (what A2P 10DLC campaign registration is
 * built around anyway) is what gets Twilio's own STOP/HELP keyword
 * handling and Advanced Opt-Out enforcement.
 *
 * `SMS_A2P_APPROVED` (pre-launch hardening, 2026-10 — see
 * docs/decisions/0033-pre-launch-audit.md) is a SEPARATE, explicit kill
 * switch from `SMS_PROVIDER`/the `TWILIO_*` credentials: TallyVis's A2P
 * 10DLC campaign is not yet approved, and real Twilio credentials can be
 * configured in Vercel (e.g. to test Console/webhook setup — see
 * docs/decisions/0032-sms-stop-start-sync.md's "Manual Twilio Console
 * actions") WITHOUT that meaning production should actually send through
 * them yet. Even with `SMS_PROVIDER=twilio` and valid credentials, a real
 * send is refused unless `SMS_A2P_APPROVED` is literally `"true"` — set it
 * only once the campaign is genuinely approved (see that ADR for the full
 * post-approval checklist). Every caller of `sendSms` already treats a
 * thrown `NotificationError` as "could not send this time" (logged,
 * swallowed, never fails the quote/job action it's attached to — see
 * `customerSms.ts`'s `dispatch`/`quoteSmsAlert.ts`'s identical pattern),
 * so this gate fails safe without breaking the surrounding workflow.
 */
function resolveSmsProvider(): SmsProvider {
  const selected = process.env.SMS_PROVIDER?.trim() || "dev";
  if (selected === "dev") return devSmsProvider;
  if (selected === "twilio") {
    if (process.env.SMS_A2P_APPROVED?.trim() !== "true") {
      throw new NotificationError(
        "SMS sending is disabled pending Twilio A2P 10DLC campaign approval. Set SMS_A2P_APPROVED=true once the campaign is approved.",
        "not-configured",
      );
    }
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
    const fromNumber = process.env.TWILIO_FROM_NUMBER;
    if (!accountSid || !authToken || (!messagingServiceSid && !fromNumber)) {
      throw new NotificationError(
        "SMS is not configured for this environment (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN and one of TWILIO_MESSAGING_SERVICE_SID/TWILIO_FROM_NUMBER are required).",
        "not-configured",
      );
    }
    return createTwilioProvider({ accountSid, authToken, messagingServiceSid, fromNumber });
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

/**
 * Whether SMS sends currently go nowhere real — either because the
 * dev/console-log provider is selected, OR because `SMS_PROVIDER=twilio`
 * but the `SMS_A2P_APPROVED` gate above isn't open yet. Surfaced to the UI
 * (same reasoning as `isUsingDevEmailProvider`) so a "not actually
 * sending" disclaimer stays accurate regardless of which of the two
 * reasons applies.
 */
export function isUsingDevSmsProvider(): boolean {
  const selected = process.env.SMS_PROVIDER?.trim() || "dev";
  if (selected !== "twilio") return true;
  return process.env.SMS_A2P_APPROVED?.trim() !== "true";
}
