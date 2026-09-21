import type { WindowCleaningCharacteristics } from "@tallyvis/types";

/**
 * Sensible starting values for manually entering job characteristics —
 * used both by the dashboard's "New quote" flow and the public estimator's
 * AI-failure manual fallback (Phase 13 — see
 * docs/decisions/0015-job-outcome-tracking.md). Always fully editable
 * before anything is saved or priced; never presented as an AI observation.
 */
export function defaultWindowCleaningCharacteristics(
  overrides: Partial<WindowCleaningCharacteristics> = {},
): WindowCleaningCharacteristics {
  return {
    vertical: "window-cleaning",
    windowCount: 20,
    windowType: "double-hung",
    paneCount: 0,
    stories: 1,
    screens: 0,
    tracks: 0,
    accessibility: "easy",
    condition: "good",
    hardWaterStaining: false,
    estimatedLaborHours: 2,
    interiorCleaning: false,
    ...overrides,
  };
}
