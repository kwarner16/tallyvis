/**
 * Rounds to the nearest cent. Every dollar amount produced anywhere in
 * packages/pricing goes through this — it's the one place that decides how
 * floating-point currency math gets tamed, so line items and totals never
 * disagree by a fraction of a cent.
 */
export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
