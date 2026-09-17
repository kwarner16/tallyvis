import type { ConfidenceLevel, Estimate } from "@tallyvis/types";

export type EstimateDisplay =
  { kind: "exact"; amount: number } | { kind: "range"; low: number; high: number };

/**
 * How much a displayed estimate widens around the real computed total,
 * purely as a function of confidence. Not fake uncertainty — it reflects
 * the same confidence level shown elsewhere in the product (see the "See
 * what Tallyvis sees" confidence messaging). packages/pricing's output
 * itself stays exact; this is presentation only. See
 * docs/decisions/0006-estimator-data-pipeline.md.
 */
const BAND_BY_CONFIDENCE: Record<ConfidenceLevel, number> = {
  high: 0,
  medium: 0.08,
  low: 0.15,
};

function roundToNearest(value: number, step: number): number {
  return Math.round(value / step) * step;
}

export function getEstimateDisplay(estimate: Estimate): EstimateDisplay {
  const band = BAND_BY_CONFIDENCE[estimate.confidence];
  if (band === 0) {
    return { kind: "exact", amount: estimate.total };
  }

  return {
    kind: "range",
    low: roundToNearest(estimate.total * (1 - band), 5),
    high: roundToNearest(estimate.total * (1 + band), 5),
  };
}
