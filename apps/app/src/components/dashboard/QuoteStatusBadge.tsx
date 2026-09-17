import type { QuoteStatus } from "@tallyvis/types";
import { cn } from "@tallyvis/ui";
import { QUOTE_STATUS_BADGE_CLASSES, QUOTE_STATUS_LABELS } from "@/lib/quoteStatusCopy";

export function QuoteStatusBadge({
  status,
  className,
}: {
  status: QuoteStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-xs font-medium",
        QUOTE_STATUS_BADGE_CLASSES[status],
        className,
      )}
    >
      {QUOTE_STATUS_LABELS[status]}
    </span>
  );
}
