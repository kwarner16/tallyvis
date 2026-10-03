/**
 * Sales Call Tracker V1 — internal admin cold-calling tool (see
 * docs/decisions/0041-sales-call-tracker.md). Shared between
 * `services/api` (validation) and `apps/app` (admin UI labels), the same
 * "policy/display constants live in packages/config" shape
 * `creatorProgram.ts`/`plans.ts` already use — never duplicated per
 * component.
 */

export type SalesCallOutcome =
  | "no_answer"
  | "voicemail"
  | "not_interested"
  | "interested"
  | "demo_requested"
  | "follow_up"
  | "signed_up";

export const SALES_CALL_OUTCOMES: readonly SalesCallOutcome[] = [
  "no_answer",
  "voicemail",
  "not_interested",
  "interested",
  "demo_requested",
  "follow_up",
  "signed_up",
];

export function isSalesCallOutcome(value: string): value is SalesCallOutcome {
  return (SALES_CALL_OUTCOMES as readonly string[]).includes(value);
}

export const SALES_CALL_OUTCOME_LABELS: Record<SalesCallOutcome, string> = {
  no_answer: "No Answer",
  voicemail: "Voicemail",
  not_interested: "Not Interested",
  interested: "Interested",
  demo_requested: "Demo / Wants Demo",
  follow_up: "Follow Up",
  signed_up: "Signed Up",
};

/**
 * Outcomes that mean a human was actually reached — the "connection
 * status" distinction from the pure sales outcome the brief asked for,
 * DERIVED from the outcome rather than a second field to fill in (see
 * the ADR's "Metrics" section for why: fewer clicks per call, one fact
 * instead of two that could disagree).
 */
export const CONNECTED_SALES_CALL_OUTCOMES: readonly SalesCallOutcome[] = [
  "not_interested",
  "interested",
  "demo_requested",
  "follow_up",
  "signed_up",
];

export function isConnectedSalesCallOutcome(outcome: string): boolean {
  return (CONNECTED_SALES_CALL_OUTCOMES as readonly string[]).includes(outcome);
}

export type SalesObjection =
  | "price"
  | "has_software"
  | "no_need"
  | "no_website"
  | "too_small"
  | "needs_to_think"
  | "needs_partner"
  | "wants_info"
  | "other";

export const SALES_OBJECTIONS: readonly SalesObjection[] = [
  "price",
  "has_software",
  "no_need",
  "no_website",
  "too_small",
  "needs_to_think",
  "needs_partner",
  "wants_info",
  "other",
];

export function isSalesObjection(value: string): value is SalesObjection {
  return (SALES_OBJECTIONS as readonly string[]).includes(value);
}

export const SALES_OBJECTION_LABELS: Record<SalesObjection, string> = {
  price: "Price",
  has_software: "Already has software/process",
  no_need: "Doesn't need estimates",
  no_website: "No website",
  too_small: "Too small / not enough volume",
  needs_to_think: "Needs to think",
  needs_partner: "Needs to talk to partner/team",
  wants_info: "Wants more information",
  other: "Other",
};

/** Quick-pick follow-up offsets — "custom" is handled separately by the UI's own date/time input, never listed here. */
export const FOLLOW_UP_QUICK_OPTIONS = [
  { key: "tomorrow", label: "Tomorrow", days: 1 },
  { key: "3_days", label: "3 days", days: 3 },
  { key: "1_week", label: "1 week", days: 7 },
] as const;
