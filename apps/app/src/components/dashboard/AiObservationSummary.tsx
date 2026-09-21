import type { ObservedValue, RawPropertyObservation } from "@tallyvis/api";
import { ConfidenceBadge } from "@/components/dashboard/ConfidenceBadge";

/**
 * "AI detected" — the human-review step Phase 11 requires (see
 * docs/decisions/0013-ai-analysis-foundation.md): shows exactly what the
 * AI could and couldn't determine, per field, before the business trusts
 * any of it. Purely presentational; the actual values it summarizes are
 * already reconciled into the editable `JobCharacteristicsFields` below
 * it in `NewQuoteClient` — this panel is what the business reviews
 * against, not a second source of truth.
 */

function titleCase(value: string): string {
  return value[0]!.toUpperCase() + value.slice(1).replace(/-/g, " ");
}

function describeObserved<T>(field: ObservedValue<T>, format: (value: T) => string): string {
  switch (field.status) {
    case "observed":
      return format(field.value);
    case "uncertain":
      return "Uncertain";
    case "unknown":
      return "Not visible in photos";
  }
}

export function AiObservationSummary({ observation }: { observation: RawPropertyObservation }) {
  const rows: { label: string; text: string }[] = [
    { label: "Stories", text: describeObserved(observation.stories, (v) => String(v)) },
    { label: "Windows", text: describeObserved(observation.windowCount, (v) => String(v)) },
    { label: "Window type", text: describeObserved(observation.windowType, titleCase) },
    { label: "Access", text: describeObserved(observation.accessibility, titleCase) },
    { label: "Condition", text: describeObserved(observation.condition, titleCase) },
    {
      label: "Hard-water staining",
      text: describeObserved(observation.hardWaterStaining, (v) => (v ? "Yes" : "No")),
    },
  ];

  return (
    <div className="rounded-xl border border-accent bg-accent-soft p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-accent-strong">AI detected</p>
        <ConfidenceBadge confidence={observation.overallConfidence} />
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {rows.map((row) => (
          <div key={row.label}>
            <dt className="text-xs text-ink-faint">{row.label}</dt>
            <dd className="text-sm font-medium text-ink">{row.text}</dd>
          </div>
        ))}
      </dl>
      {observation.warnings.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1 border-t border-accent/30 pt-3 text-xs text-ink-soft">
          {observation.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
      <p className="mt-3 border-t border-accent/30 pt-3 text-xs text-accent-strong">
        The fields below have been pre-filled from this analysis — review and adjust anything before
        saving. Tallyvis&rsquo;s pricing is always calculated from what you confirm here, never directly
        from the AI.
      </p>
    </div>
  );
}
