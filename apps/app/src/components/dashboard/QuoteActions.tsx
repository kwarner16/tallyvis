import type { QuoteStatus } from "@tallyvis/types";
import { canTransitionQuoteStatus } from "@tallyvis/types";
import { buttonVariants } from "@tallyvis/ui";

const ACTIONS: { label: string; target: QuoteStatus; variant: "primary" | "outline" }[] = [
  { label: "Approve estimate", target: "approved", variant: "primary" },
  { label: "Send estimate", target: "sent", variant: "primary" },
  { label: "Request more information", target: "more_information", variant: "outline" },
  { label: "Reject", target: "declined", variant: "outline" },
];

export interface QuoteActionsProps {
  status: QuoteStatus;
  onTransition: (target: QuoteStatus) => void;
  onEditAnalysis: () => void;
  onRecalculate: () => void;
  disabled?: boolean;
}

/** Only ever shows actions the centralized QUOTE_STATUS_TRANSITIONS map allows from the current status. */
export function QuoteActions({
  status,
  onTransition,
  onEditAnalysis,
  onRecalculate,
  disabled,
}: QuoteActionsProps) {
  const available = ACTIONS.filter((action) => canTransitionQuoteStatus(status, action.target));
  const isTerminal = status === "accepted" || status === "declined";

  return (
    <div className="flex flex-wrap gap-3">
      {available.map((action) => (
        <button
          key={action.target}
          type="button"
          disabled={disabled}
          onClick={() => onTransition(action.target)}
          className={buttonVariants({ variant: action.variant })}
        >
          {action.label}
        </button>
      ))}
      {!isTerminal ? (
        <>
          <button
            type="button"
            disabled={disabled}
            onClick={onEditAnalysis}
            className={buttonVariants({ variant: "outline" })}
          >
            Edit analysis
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={onRecalculate}
            className={buttonVariants({ variant: "outline" })}
          >
            Recalculate
          </button>
        </>
      ) : null}
    </div>
  );
}
