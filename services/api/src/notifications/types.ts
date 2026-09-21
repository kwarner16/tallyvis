/**
 * Phase 14 — a small server-side notification abstraction (see
 * docs/decisions/0016-onboarding-billing-embed.md). Deliberately mirrors
 * `services/ai/src/providers/types.ts`'s `AiProvider`/`AiProviderError`
 * shape: a narrow interface, a categorized error, and provider selection
 * resolved once from environment variables in one file. Email first; an
 * `SmsProvider` would follow the identical pattern if/when a vertical
 * actually needs it — not built speculatively.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain-text body — always sent alongside `html`, never the only body, so a client that can't render HTML still gets the content. */
  text: string;
  html: string;
}

export interface EmailProvider {
  /** For error messages and logging — never a secret. */
  readonly name: string;
  send(message: EmailMessage): Promise<{ providerMessageId?: string }>;
}

export type NotificationErrorCategory =
  | "not-configured"
  | "invalid-recipient"
  | "provider-error"
  | "rate-limit"
  | "unknown";

/** Thrown instead of a bare `Error` so a caller can tell "not configured" from "the provider rejected it" apart, exactly like `AiProviderError`. `message` is always safe to display or log as-is. */
export class NotificationError extends Error {
  readonly category: NotificationErrorCategory;

  constructor(message: string, category: NotificationErrorCategory) {
    super(message);
    this.name = "NotificationError";
    this.category = category;
  }
}
