import type { NotificationErrorCategory } from "@tallyvis/api";

/** Phase 14 — turns a `NotificationError`'s category into a safe, specific user-facing sentence, the same `describeAiErrorCategory` pattern this app already uses for AI failures. */
const CATEGORY_MESSAGES: Record<NotificationErrorCategory, string> = {
  "not-configured": "Email isn't configured for this environment yet.",
  "invalid-recipient": "The customer's email address was rejected by the email provider.",
  "provider-error": "The email provider had a problem sending this message.",
  "rate-limit": "The email provider is busy right now — please try again in a moment.",
  unknown: "Something went wrong while sending this email.",
};

export function describeNotificationErrorCategory(category: NotificationErrorCategory): string {
  return CATEGORY_MESSAGES[category];
}
