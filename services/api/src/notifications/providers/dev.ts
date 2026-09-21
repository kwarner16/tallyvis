import type { EmailMessage, EmailProvider } from "../types";

/**
 * ============================== DEV EMAIL PROVIDER ==============================
 * NEVER sends a real email. Logs the full message — including the actual
 * link a real send would contain (a password reset link, a quote share
 * link) — to the server console (stderr/stdout only, never returned to a
 * browser) so the corresponding flow can be exercised end-to-end in local
 * development without any email provider configured. This is the default
 * provider (`EMAIL_PROVIDER` unset or "dev") — a business's real customer
 * data is never routed through this path once `EMAIL_PROVIDER=resend` is
 * configured with real credentials. See
 * docs/decisions/0016-onboarding-billing-embed.md.
 * ==================================================================================
 */
async function send(message: EmailMessage): Promise<{ providerMessageId?: string }> {
  console.log(
    JSON.stringify({
      at: new Date().toISOString(),
      event: "dev-email-simulated",
      note: "NOT a real email — EMAIL_PROVIDER is unset/dev. See services/api/src/notifications/providers/dev.ts.",
      to: message.to,
      subject: message.subject,
      text: message.text,
    }),
  );
  return { providerMessageId: undefined };
}

export const devEmailProvider: EmailProvider = { name: "dev", send };
