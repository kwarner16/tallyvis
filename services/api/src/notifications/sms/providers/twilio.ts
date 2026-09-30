import type { SmsMessage, SmsProvider } from "../types";
import { NotificationError } from "../../types";

/**
 * A real SMS provider, via Twilio's Messages REST API
 * (https://www.twilio.com/docs/sms/api/message-resource#create-a-message-resource)
 * — plain `fetch`, deliberately no `twilio` SDK dependency, the same choice
 * this repo already made for Resend (see `../../providers/resend.ts`).
 * Only reached when `SMS_PROVIDER=twilio` and the three `TWILIO_*`
 * credentials below are all set; they're read exclusively in
 * `services/api/src/notifications/sms/index.ts`, never bundled to a
 * browser, never logged. See
 * docs/decisions/0028-mobile-sms-embed-and-growth-updates.md for exactly
 * what Kyle needs to configure — this integration has NOT been exercised
 * against a real Twilio account in this environment (no credentials were
 * available here); only `devSmsProvider` has actually been exercised, via
 * the tests in `__tests__/quoteSmsAlert.test.ts` (the same "test the
 * feature, not a standalone HTTP-mock test for the provider" convention
 * `../../providers/resend.ts` already follows — see `__tests__/quoteEmail.test.ts`).
 * Treat this file as architecture-verified, not live-verified, until a real
 * send is confirmed.
 */

export interface TwilioProviderConfig {
  accountSid: string;
  authToken: string;
  /**
   * Exactly one of these two is required (enforced by `../index.ts`'s
   * `resolveSmsProvider`, not here) — `messagingServiceSid` is strongly
   * preferred: Twilio's A2P 10DLC campaign registration is itself built
   * around a Messaging Service, and sending through one is what actually
   * gets you Twilio's own STOP/HELP keyword handling and Advanced Opt-Out
   * enforcement for free (see docs/decisions/0029-sms-consent-and-a2p-10dlc.md
   * — TallyVis has no inbound webhook of its own). `fromNumber` (a bare
   * long code, no Messaging Service) is kept only as a lower-effort local/
   * dev-testing fallback; it does NOT get Twilio's automatic opt-out
   * handling the same way.
   */
  messagingServiceSid?: string;
  fromNumber?: string;
  baseUrl?: string;
}

interface TwilioErrorResponse {
  code?: number;
  message?: string;
}

export function createTwilioProvider(config: TwilioProviderConfig): SmsProvider {
  const baseUrl = config.baseUrl ?? "https://api.twilio.com";
  const authHeader = `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`;

  async function send(message: SmsMessage): Promise<{ providerMessageId?: string }> {
    const requestBody = new URLSearchParams({ To: message.to, Body: message.body });
    if (config.messagingServiceSid) requestBody.set("MessagingServiceSid", config.messagingServiceSid);
    else if (config.fromNumber) requestBody.set("From", config.fromNumber);

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/2010-04-01/Accounts/${config.accountSid}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: requestBody,
      });
    } catch {
      throw new NotificationError("Could not reach the SMS provider.", "provider-error");
    }

    if (response.status === 429) {
      throw new NotificationError("The SMS provider is rate-limiting requests.", "rate-limit");
    }

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as TwilioErrorResponse;
      if (response.status === 401 || response.status === 403) {
        throw new NotificationError("The SMS provider rejected the configured credentials.", "provider-error");
      }
      if (response.status === 400) {
        throw new NotificationError(body.message ?? "The recipient phone number was rejected.", "invalid-recipient");
      }
      throw new NotificationError(`The SMS provider returned an error (status ${response.status}).`, "provider-error");
    }

    const body = (await response.json()) as { sid: string };
    return { providerMessageId: body.sid };
  }

  return { name: "twilio", send };
}
