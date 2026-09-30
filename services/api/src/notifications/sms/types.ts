/**
 * Phase 15 (see docs/decisions/0028-mobile-sms-embed-and-growth-updates.md)
 * — SMS follows the exact same abstraction shape as `../types.ts`'s
 * `EmailProvider`, as that file's own comment anticipated: a narrow
 * interface, a categorized error (reused from `../types.ts` rather than
 * duplicated — the taxonomy of "not configured" / "invalid recipient" /
 * "provider rejected it" / "rate limited" applies identically to SMS), and
 * provider selection resolved once from environment variables in one file
 * (`./index.ts`).
 */

export interface SmsMessage {
  /** E.164, e.g. "+15555551234" — callers must normalize before constructing this (see `../../lib/phone.ts`). */
  to: string;
  body: string;
}

export interface SmsProvider {
  /** For error messages and logging — never a secret. */
  readonly name: string;
  send(message: SmsMessage): Promise<{ providerMessageId?: string }>;
}
