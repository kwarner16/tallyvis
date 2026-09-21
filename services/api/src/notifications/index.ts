import { devEmailProvider } from "./providers/dev";
import { createResendProvider } from "./providers/resend";
import { logNotificationEvent, maskRecipient } from "./logging";
import { NotificationError, type EmailMessage, type EmailProvider } from "./types";

export { NotificationError, type EmailMessage, type EmailProvider, type NotificationErrorCategory } from "./types";

/**
 * Phase 14 — the notification provider abstraction (see
 * docs/decisions/0016-onboarding-billing-embed.md). This file is the only
 * place `EMAIL_PROVIDER`/`RESEND_API_KEY`/`EMAIL_FROM_ADDRESS` are read —
 * every caller (password reset, quote email) only ever calls `sendEmail()`
 * below, never a provider directly, the same pattern `services/ai/index.ts`
 * already established for AI providers.
 */
function resolveEmailProvider(): EmailProvider {
  const selected = process.env.EMAIL_PROVIDER?.trim() || "dev";
  if (selected === "dev") return devEmailProvider;
  if (selected === "resend") {
    const apiKey = process.env.RESEND_API_KEY;
    const fromAddress = process.env.EMAIL_FROM_ADDRESS;
    if (!apiKey || !fromAddress) {
      throw new NotificationError(
        "Email is not configured for this environment (RESEND_API_KEY/EMAIL_FROM_ADDRESS missing).",
        "not-configured",
      );
    }
    return createResendProvider({ apiKey, fromAddress });
  }
  throw new NotificationError(`Unknown EMAIL_PROVIDER "${selected}". Expected "dev" or "resend".`, "not-configured");
}

/**
 * The one function every caller in this package uses to send an email —
 * resolves the configured provider, sends, and logs one structured dev
 * line either way. `kind` is a short label ("password-reset",
 * "quote-notification") for the log line only, not part of the message.
 */
export async function sendEmail(message: EmailMessage, kind: string): Promise<{ providerMessageId?: string }> {
  const startedAt = Date.now();
  let provider: EmailProvider;
  try {
    provider = resolveEmailProvider();
  } catch (err) {
    logNotificationEvent({
      channel: "email",
      provider: "unresolved",
      kind,
      success: false,
      latencyMs: Date.now() - startedAt,
      recipientMasked: maskRecipient(message.to),
      errorCategory: err instanceof NotificationError ? err.category : "unknown",
    });
    throw err;
  }

  try {
    const result = await provider.send(message);
    logNotificationEvent({
      channel: "email",
      provider: provider.name,
      kind,
      success: true,
      latencyMs: Date.now() - startedAt,
      recipientMasked: maskRecipient(message.to),
    });
    return result;
  } catch (err) {
    const wrapped =
      err instanceof NotificationError
        ? err
        : new NotificationError(err instanceof Error ? err.message : `The "${provider.name}" email provider failed.`, "unknown");
    logNotificationEvent({
      channel: "email",
      provider: provider.name,
      kind,
      success: false,
      latencyMs: Date.now() - startedAt,
      recipientMasked: maskRecipient(message.to),
      errorCategory: wrapped.category,
    });
    throw wrapped;
  }
}

/** Whether email is currently the dev/console-log provider rather than a real one — surfaced to the UI so a "simulated" disclaimer stays accurate, the same reasoning `isUsingMockAiProviderAction` already applies to AI. */
export function isUsingDevEmailProvider(): boolean {
  return (process.env.EMAIL_PROVIDER?.trim() || "dev") !== "resend";
}
