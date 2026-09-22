import type { EmailMessage, EmailProvider } from "../types";
import { NotificationError } from "../types";

/**
 * A real transactional-email provider, via Resend's HTTP API
 * (https://resend.com/docs/api-reference/emails/send-email) — plain
 * `fetch`, deliberately no SDK dependency, the same choice this repo
 * already made for other server-only HTTP integrations. Only reached when
 * `EMAIL_PROVIDER=resend` and `RESEND_API_KEY` are both set; the key is
 * read exclusively in this file, never bundled to a browser, never logged.
 * See docs/decisions/0016-onboarding-billing-embed.md.
 *
 * Human-verified against the real Resend API in this environment (see
 * docs/decisions/0016-onboarding-billing-embed.md and the recovery notes
 * that followed it): a real password-reset email was successfully
 * delivered with `EMAIL_PROVIDER=resend` and a real `RESEND_API_KEY`
 * configured. Still, don't treat a passing test suite alone (which only
 * exercises `devEmailProvider` and a local fake HTTP server) as proof this
 * integration works — that proof is the human-confirmed real send above,
 * not the unit tests.
 */

export interface ResendProviderConfig {
  apiKey: string;
  fromAddress: string;
  baseUrl?: string;
}

interface ResendSuccessResponse {
  id: string;
}

interface ResendErrorResponse {
  statusCode?: number;
  message?: string;
  name?: string;
}

export function createResendProvider(config: ResendProviderConfig): EmailProvider {
  const baseUrl = config.baseUrl ?? "https://api.resend.com";

  async function send(message: EmailMessage): Promise<{ providerMessageId?: string }> {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/emails`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: config.fromAddress,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
      });
    } catch {
      throw new NotificationError("Could not reach the email provider.", "provider-error");
    }

    if (response.status === 429) {
      throw new NotificationError("The email provider is rate-limiting requests.", "rate-limit");
    }

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as ResendErrorResponse;
      if (response.status === 401 || response.status === 403) {
        throw new NotificationError("The email provider rejected the configured credentials.", "provider-error");
      }
      if (response.status === 422 || response.status === 400) {
        throw new NotificationError(body.message ?? "The recipient address was rejected.", "invalid-recipient");
      }
      throw new NotificationError(`The email provider returned an error (status ${response.status}).`, "provider-error");
    }

    const body = (await response.json()) as ResendSuccessResponse;
    return { providerMessageId: body.id };
  }

  return { name: "resend", send };
}
