/**
 * Founding Creator Outreach Tracker V1 — internal admin cold-outreach
 * tool (see docs/decisions/0042-creator-outreach-tracker.md). Shared
 * between `services/api` (validation) and `apps/app` (admin UI labels),
 * the same "policy/display constants live in packages/config" shape
 * `salesCallTracker.ts`/`creatorProgram.ts` already use.
 */

export type CreatorOutreachStatus =
  | "not_contacted"
  | "email1_sent"
  | "awaiting_reply"
  | "replied"
  | "interested"
  | "not_interested"
  | "follow_up"
  | "email2_sent"
  | "converted";

export const CREATOR_OUTREACH_STATUSES: readonly CreatorOutreachStatus[] = [
  "not_contacted",
  "email1_sent",
  "awaiting_reply",
  "replied",
  "interested",
  "not_interested",
  "follow_up",
  "email2_sent",
  "converted",
];

export function isCreatorOutreachStatus(value: string): value is CreatorOutreachStatus {
  return (CREATOR_OUTREACH_STATUSES as readonly string[]).includes(value);
}

export const CREATOR_OUTREACH_STATUS_LABELS: Record<CreatorOutreachStatus, string> = {
  not_contacted: "Not Contacted",
  email1_sent: "Email #1 Sent",
  awaiting_reply: "Awaiting Reply",
  replied: "Replied",
  interested: "Interested",
  not_interested: "Not Interested",
  follow_up: "Follow Up",
  email2_sent: "Email #2 Sent",
  converted: "Converted",
};

/** Quick-pick follow-up offsets — mirrors the Sales Call Tracker's identical constant. "Custom" is handled by the UI's own date/time input. */
export const CREATOR_OUTREACH_FOLLOW_UP_QUICK_OPTIONS = [
  { key: "tomorrow", label: "Tomorrow", days: 1 },
  { key: "3_days", label: "3 days", days: 3 },
  { key: "1_week", label: "1 week", days: 7 },
] as const;
