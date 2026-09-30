import type { SmsMessage, SmsProvider } from "../types";

/**
 * ============================== DEV SMS PROVIDER ==============================
 * NEVER sends a real text message. Logs the full message — including the
 * body a real send would contain — to the server console (stderr/stdout
 * only, never returned to a browser) so the new-quote-alert flow can be
 * exercised end-to-end in local development without any SMS provider
 * configured. This is the default provider (`SMS_PROVIDER` unset or "dev")
 * — a business's real customer/owner data is never routed through this
 * path once `SMS_PROVIDER=twilio` is configured with real credentials. See
 * docs/decisions/0028-mobile-sms-embed-and-growth-updates.md.
 * ================================================================================
 */
async function send(message: SmsMessage): Promise<{ providerMessageId?: string }> {
  console.log(
    JSON.stringify({
      at: new Date().toISOString(),
      event: "dev-sms-simulated",
      note: "NOT a real text message — SMS_PROVIDER is unset/dev. See services/api/src/notifications/sms/providers/dev.ts.",
      to: message.to,
      body: message.body,
    }),
  );
  return { providerMessageId: undefined };
}

export const devSmsProvider: SmsProvider = { name: "dev", send };
