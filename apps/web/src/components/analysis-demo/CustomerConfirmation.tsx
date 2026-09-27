"use client";

import { buttonVariants } from "@tallyvis/ui";

export interface CustomerConfirmationProps {
  detectedCount: number;
  confirmedCount: number;
  confirmed: boolean;
  onConfirm: () => void;
}

/**
 * The "Tallyvis does not blindly guess" moment (see docs/product's
 * confidence/confirmation principle) — a small, honest example of an
 * uncertain detection (a window partially hidden from view) that the
 * customer resolves before it becomes a quote, exactly like the real
 * estimator's confirm step. Deliberately shows only a plain window count,
 * never a raw confidence percentage or AI schema field.
 */
export function CustomerConfirmation({
  detectedCount,
  confirmedCount,
  confirmed,
  onConfirm,
}: CustomerConfirmationProps) {
  if (confirmed) {
    return (
      <div
        className="flex items-center gap-2.5 rounded-xl border border-line bg-paper px-4 py-3 text-sm text-ink-soft"
        style={{ animation: "fade-in 0.35s ease-out" }}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          className="h-4 w-4 shrink-0 text-accent-strong"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        <span>
          Customer confirmed <strong className="font-semibold text-ink">{confirmedCount} windows</strong> &mdash;
          price updated.
        </span>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border border-accent/40 bg-accent-soft px-4 py-3"
      style={{ animation: "fade-in 0.35s ease-out" }}
    >
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-accent-strong">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          className="h-3.5 w-3.5 shrink-0"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a1.5 1.5 0 0 0 1.29 2.25h17.78A1.5 1.5 0 0 0 22.18 18L13.71 3.86a1.5 1.5 0 0 0-2.42 0Z"
          />
        </svg>
        Partially obscured &mdash; confirmation requested
      </p>
      <p className="mb-3 text-sm text-ink-soft">
        Tallyvis detected <strong className="font-semibold text-ink">{detectedCount} windows</strong>, but one
        may be hidden from view. The customer confirms or corrects it before this becomes a quote.
      </p>
      <button
        type="button"
        onClick={onConfirm}
        className={buttonVariants({ variant: "primary", className: "w-full sm:w-auto" })}
      >
        Confirm: {confirmedCount} windows
      </button>
    </div>
  );
}
