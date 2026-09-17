import Link from "next/link";
import { buttonVariants } from "@tallyvis/ui";

export interface StepFooterProps {
  backHref?: string;
  onContinue?: () => void;
  continueHref?: string;
  continueLabel?: string;
  continueDisabled?: boolean;
}

/** Consistent Back/Continue row for each estimator step. */
export function StepFooter({
  backHref,
  onContinue,
  continueHref,
  continueLabel = "Continue",
  continueDisabled,
}: StepFooterProps) {
  return (
    <div className="mt-10 flex items-center justify-between gap-4 border-t border-line pt-6">
      {backHref ? (
        <Link href={backHref} className={buttonVariants({ variant: "outline" })}>
          Back
        </Link>
      ) : (
        <span />
      )}

      {continueHref && !continueDisabled ? (
        <Link href={continueHref} className={buttonVariants({ variant: "primary" })}>
          {continueLabel}
        </Link>
      ) : (
        <button
          type="button"
          onClick={onContinue}
          disabled={continueDisabled}
          className={buttonVariants({ variant: "primary" })}
        >
          {continueLabel}
        </button>
      )}
    </div>
  );
}
