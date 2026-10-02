/**
 * TallyVis Founding Creator Program — the single authoritative default for
 * a new creator's commission terms (see
 * docs/decisions/0040-creator-affiliate-program.md). Mirrors `trial.ts`'s
 * own "one policy object, nowhere else hard-codes the number" pattern.
 *
 * Basis points (bps), not a float percentage, for the same reason money
 * amounts are stored in integer cents elsewhere in this repo — avoids any
 * floating-point rounding ambiguity when computing a commission amount
 * (`collectedAmountCents * commissionRateBps / 10_000`). 2000 bps = 20%.
 *
 * These are only the DEFAULTS applied when Kyle creates a new creator —
 * `creators.commission_rate_bps`/`creators.commission_duration_months` are
 * per-creator columns that can be set differently for any individual
 * creator without touching this file or rewriting any existing creator's
 * stored value. See that migration's own comment for why each commission
 * record additionally freezes the rate/duration that produced it,
 * independent of both this default and the creator's current setting.
 */
export const CREATOR_PROGRAM_POLICY = {
  defaultCommissionRateBps: 2000,
  defaultCommissionDurationMonths: 12,
} as const;

/** Formats basis points as a human percentage string, e.g. 2000 -> "20%". Rounds to at most one decimal place — commission rates are always whole or half percents in practice, never set to a precision this would lose. */
export function formatBasisPointsAsPercent(bps: number): string {
  const percent = bps / 100;
  return `${Number(percent.toFixed(1))}%`;
}
