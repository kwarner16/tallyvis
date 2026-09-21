import type { WindowCleaningCharacteristics } from "@tallyvis/types";
import type { ObservedValue, RawPropertyObservation } from "./types";

/**
 * Phase 13 — real-world job outcome & data collection foundation. See
 * docs/decisions/0015-job-outcome-tracking.md.
 *
 * `reconcile.ts` already turns a `RawPropertyObservation` into the
 * confirmed `WindowCleaningCharacteristics` a business reviews and saves —
 * but once saved, the two are collapsed into one value and the original
 * AI observation is gone unless a caller preserves it separately (see
 * `Quote.ai_observation_json`, alongside `quotes.analysis_json`). This is
 * the other direction: given both, line them back up field-by-field so a
 * human can see exactly what the AI observed vs. what was ultimately
 * confirmed — the raw comparison this phase's data-collection goal needs,
 * not a re-run of any pricing or reconciliation logic.
 */

export interface ObservationComparisonRow {
  field: string;
  label: string;
  status: ObservedValue<unknown>["status"];
  /** Formatted for display — `null` when the AI never committed to a value (status is "uncertain" or "unknown"), so there's nothing to show. */
  observedText: string | null;
  /** Always present — the confirmed characteristics always have a concrete value. */
  confirmedText: string;
  /**
   * True only when the AI committed to an observed value AND that value
   * differs from what was ultimately confirmed — i.e., a human overrode an
   * actual AI observation, not merely filled in a gap the AI left as
   * uncertain/unknown. That distinction matters: only the former is a
   * genuine "the AI was wrong" data point.
   */
  corrected: boolean;
}

function titleCase(value: string): string {
  return value[0]!.toUpperCase() + value.slice(1).replace(/-/g, " ");
}

function fieldRow<T>(
  field: string,
  label: string,
  observed: ObservedValue<T>,
  confirmed: T,
  format: (value: T) => string,
): ObservationComparisonRow {
  const confirmedText = format(confirmed);
  if (observed.status !== "observed") {
    return { field, label, status: observed.status, observedText: null, confirmedText, corrected: false };
  }
  const observedText = format(observed.value);
  return { field, label, status: "observed", observedText, confirmedText, corrected: observedText !== confirmedText };
}

/**
 * Every field `RawPropertyObservation` and `WindowCleaningCharacteristics`
 * share — `paneCount` and `interiorCleaning` aren't in the AI schema (see
 * docs/decisions/0014-ai-real-world-refinement.md for `paneCount`'s
 * deliberate deferral), so they have nothing to compare against and are
 * left out rather than shown as a false "not observed" row.
 */
export function compareObservationToCharacteristics(
  observation: RawPropertyObservation,
  characteristics: WindowCleaningCharacteristics,
): ObservationComparisonRow[] {
  return [
    fieldRow("stories", "Stories", observation.stories, characteristics.stories, String),
    fieldRow("windowCount", "Windows", observation.windowCount, characteristics.windowCount, String),
    fieldRow("windowType", "Window type", observation.windowType, characteristics.windowType, titleCase),
    fieldRow("screens", "Screens", observation.screens, characteristics.screens, String),
    fieldRow("tracks", "Tracks", observation.tracks, characteristics.tracks, String),
    fieldRow("accessibility", "Access", observation.accessibility, characteristics.accessibility, titleCase),
    fieldRow("condition", "Condition", observation.condition, characteristics.condition, titleCase),
    fieldRow(
      "hardWaterStaining",
      "Hard-water staining",
      observation.hardWaterStaining,
      characteristics.hardWaterStaining,
      (v) => (v ? "Yes" : "No"),
    ),
  ];
}

/** True if the AI committed to at least one value the human later changed — the summary flag list/detail views show without rendering the full field-by-field table. */
export function wasObservationCorrected(
  observation: RawPropertyObservation,
  characteristics: WindowCleaningCharacteristics,
): boolean {
  return compareObservationToCharacteristics(observation, characteristics).some((row) => row.corrected);
}
