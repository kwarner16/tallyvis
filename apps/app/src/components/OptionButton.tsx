import type { ReactNode } from "react";
import { cn } from "@tallyvis/ui";

export interface OptionButtonProps {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}

export function OptionButton({ selected, onClick, children }: OptionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "rounded-xl border px-4 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
        selected
          ? "border-accent-strong bg-accent-soft text-accent-strong"
          : "border-line bg-paper text-ink-soft hover:border-ink-faint",
      )}
    >
      {children}
    </button>
  );
}
