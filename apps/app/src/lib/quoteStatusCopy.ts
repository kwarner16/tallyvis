import type { QuoteStatus } from "@tallyvis/types";

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  new: "New",
  needs_review: "Needs review",
  more_information: "More info needed",
  approved: "Approved",
  sent: "Sent",
  accepted: "Accepted",
  declined: "Declined",
};

export const QUOTE_STATUS_BADGE_CLASSES: Record<QuoteStatus, string> = {
  new: "border-accent bg-accent-soft text-accent-strong",
  needs_review: "border-transparent bg-accent-strong text-paper",
  more_information: "border-accent/50 bg-paper text-accent-strong",
  approved: "border-ink-faint bg-paper text-ink",
  sent: "border-ink bg-paper text-ink",
  accepted: "border-transparent bg-ink text-paper",
  declined: "border-line bg-paper text-ink-faint",
};

export const QUOTE_FILTERS: { value: QuoteStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "new", label: "New" },
  { value: "needs_review", label: "Needs review" },
  { value: "approved", label: "Approved" },
  { value: "sent", label: "Sent" },
  { value: "accepted", label: "Accepted" },
  { value: "declined", label: "Declined" },
];
