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
  /**
   * V1.1 (see docs/decisions/0040's addendum) — the "Active Creator"
   * program rule: at least this many qualifying content pieces per
   * calendar month, with no minimum view/engagement/conversion count.
   * Purely a documentation/display constant — TallyVis does not, and
   * does not claim to, automatically verify content publication (see
   * `services/creators.ts`'s activity-recording functions, which are
   * manual admin entry only).
   */
  minimumQualifyingContentPiecesPerMonth: 1,
  /**
   * How long an accrued commission sits before Kyle should consider it
   * actually payable, to let a refund/chargeback land first. Purely a
   * documentation/display constant (surfaced on the admin dashboard as
   * "pending" vs "payable") — never enforced as a hard block on
   * `markCommissionPaidAdmin`, since Kyle may have a legitimate reason to
   * pay early (e.g. ending a relationship) and V1.1 has no payout
   * automation to need a hard gate.
   */
  payoutHoldingPeriodDays: 30,
  /** Below this, a creator's payable balance is documented as "rolls forward" rather than something Kyle is expected to action immediately — also purely a documentation/display constant, never enforced in code (see `payoutHoldingPeriodDays`'s own comment for why). */
  minimumPayoutCents: 2500,
} as const;

/** Formats basis points as a human percentage string, e.g. 2000 -> "20%". Rounds to at most one decimal place — commission rates are always whole or half percents in practice, never set to a precision this would lose. */
export function formatBasisPointsAsPercent(bps: number): string {
  const percent = bps / 100;
  return `${Number(percent.toFixed(1))}%`;
}
