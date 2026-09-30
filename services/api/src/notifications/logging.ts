import type { NotificationErrorCategory } from "./types";

/**
 * Dev-visibility logging for outbound notifications — mirrors
 * `services/ai/src/logging.ts`'s shape and reasoning exactly. Never logs
 * the message body/subject or the full recipient address: only a masked
 * form (`j***@example.com` / `+1555***1234`) so a log line is useful for
 * "is this working" without becoming a second place customer PII ends up
 * retained. Shared across channels (email, sms) rather than duplicated per
 * channel — the shape and the privacy reasoning are identical either way.
 */
export interface NotificationLogEvent {
  channel: "email" | "sms";
  provider: string;
  kind: string;
  success: boolean;
  latencyMs: number;
  recipientMasked: string;
  errorCategory?: NotificationErrorCategory;
}

export function maskRecipient(address: string): string {
  const [local, domain] = address.split("@");
  if (!local || !domain) return "***";
  return `${local[0] ?? ""}***@${domain}`;
}

/** Masks all but the country code and the last 4 digits of an E.164 phone number, e.g. "+15555551234" -> "+1555***1234". */
export function maskPhone(e164: string): string {
  const digits = e164.replace(/[^\d]/g, "");
  if (digits.length < 5) return "***";
  const last4 = digits.slice(-4);
  const prefix = digits.slice(0, Math.max(0, digits.length - 4 - 3));
  return `+${prefix}***${last4}`;
}

export function logNotificationEvent(event: NotificationLogEvent): void {
  const line = { at: new Date().toISOString(), event: "notification", ...event };
  if (event.success) console.log(JSON.stringify(line));
  else console.error(JSON.stringify(line));
}
