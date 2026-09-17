import type { ConfidenceLevel } from "@tallyvis/types";
import { cn } from "@tallyvis/ui";
import { CONFIDENCE_COPY } from "@/lib/confidenceCopy";

const TONE_CLASSES: Record<ConfidenceLevel, string> = {
  high: "border-accent bg-accent-soft text-accent-strong",
  medium: "border-line bg-paper-alt text-ink",
  low: "border-line bg-paper text-ink-faint",
};

export function ConfidenceBadge({
  confidence,
  showHint = false,
  className,
}: {
  confidence: ConfidenceLevel;
  showHint?: boolean;
  className?: string;
}) {
  const copy = CONFIDENCE_COPY[confidence];
  return (
    <span className={cn("inline-flex flex-col gap-0.5", className)}>
      <span
        className={cn(
          "inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-xs font-medium",
          TONE_CLASSES[confidence],
        )}
      >
        {copy.label}
      </span>
      {showHint ? <span className="text-xs text-ink-faint">{copy.hint}</span> : null}
    </span>
  );
}
