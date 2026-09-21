import type { NotificationErrorCategory } from "./types";

/**
 * Dev-visibility logging for outbound notifications — mirrors
 * `services/ai/src/logging.ts`'s shape and reasoning exactly. Never logs
 * the message body/subject or the full recipient address: only a masked
 * form (`j***@example.com`) so a log line is useful for "is this working"
 * without becoming a second place customer PII ends up retained.
 */
export interface NotificationLogEvent {
  channel: "email";
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

export function logNotificationEvent(event: NotificationLogEvent): void {
  const line = { at: new Date().toISOString(), event: "notification", ...event };
  if (event.success) console.log(JSON.stringify(line));
  else console.error(JSON.stringify(line));
}
