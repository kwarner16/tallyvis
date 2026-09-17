import type { ConfidenceLevel } from "@tallyvis/types";

/**
 * Confidence copy consistent with the marketing site's "Tallyvis knows when
 * it doesn't know" messaging: high confidence proceeds automatically,
 * medium asks for a human look, low needs more information before an
 * estimate can be trusted.
 */
export const CONFIDENCE_COPY: Record<ConfidenceLevel, { label: string; hint: string }> = {
  high: { label: "High confidence", hint: "Can proceed automatically." },
  medium: { label: "Medium confidence", hint: "Review recommended before sending." },
  low: { label: "Low confidence", hint: "Additional information needed." },
};
