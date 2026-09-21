import type { ConfidenceLevel, Estimate } from "@tallyvis/types";

/**
 * A minimal, server-side formatter for a quote email's plain-text/HTML
 * body — deliberately a small, independent copy of the confidence-based
 * rounding `apps/app/src/lib/estimateDisplay.ts` already does for on-page
 * display, not an import of it: `services/api` cannot depend on an app
 * (see CLAUDE.md's module boundary rules), and this is the one place that
 * formatting is needed outside apps/app. `packages/pricing`'s own output
 * stays exact; this, like its apps/app counterpart, is presentation only.
 */
const BAND_BY_CONFIDENCE: Record<ConfidenceLevel, number> = { high: 0, medium: 0.08, low: 0.15 };

function roundToNearest(value: number, step: number): number {
  return Math.round(value / step) * step;
}

export function getEstimateDisplayTotal(estimate: Estimate): string {
  const band = BAND_BY_CONFIDENCE[estimate.confidence];
  if (band === 0) return `$${estimate.total.toFixed(2)}`;
  const low = roundToNearest(estimate.total * (1 - band), 5);
  const high = roundToNearest(estimate.total * (1 + band), 5);
  return `$${low}–$${high}`;
}
