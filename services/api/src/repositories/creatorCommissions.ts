import { makeId } from "../db/ids";
import type { Queryable } from "../db/pg/client";

export type CreatorCommissionStatus = "accrued" | "reversed" | "paid";

/** One row per commission-eligible Stripe invoice payment — see db/pg/migrations/0015_creator_program.sql and 0016_creator_program_v1_1.sql's own comments for the full field-by-field reasoning. */
export interface CreatorCommission {
  id: string;
  creatorId: string;
  referralId: string;
  businessId: string;
  stripeInvoiceId: string;
  stripeChargeId?: string;
  /** The full, gross amount Stripe actually collected for this invoice — audit/display only; commission is calculated from `commissionableAmountCents` below, not this. */
  collectedAmountCents: number;
  /** `collectedAmountCents` minus any reliably-identifiable tax (Stripe's own `invoice.tax` field) — the actual base commission is calculated from. Equal to `collectedAmountCents` whenever no tax was collected. */
  commissionableAmountCents: number;
  currency: string;
  commissionRateBps: number;
  commissionAmountCents: number;
  periodStart?: string;
  periodEnd?: string;
  status: CreatorCommissionStatus;
  /** Cumulative total of `commissionableAmountCents` refunded so far, mirrored from Stripe's own cumulative `charge.amount_refunded` — see `services/creatorCommissions.ts`'s `processChargeRefunded`. Never exceeds `commissionableAmountCents`. */
  refundedCollectedCents: number;
  /** Always `round(refundedCollectedCents * commissionRateBps / 10000)`, capped at `commissionAmountCents` — the proportional reversal this refund total implies. Re-derived from `refundedCollectedCents` on every refund event, never incremented independently, which is exactly what makes it safe across multiple partial refunds and idempotent against webhook replay. */
  reversedCommissionCents: number;
  reversedAt?: string;
  paidAt?: string;
  payoutNote?: string;
  createdAt: string;
  updatedAt: string;
}

interface CreatorCommissionRow {
  id: string;
  creator_id: string;
  referral_id: string;
  business_id: string;
  stripe_invoice_id: string;
  stripe_charge_id: string | null;
  collected_amount_cents: number;
  commissionable_amount_cents: number;
  currency: string;
  commission_rate_bps: number;
  commission_amount_cents: number;
  period_start: string | null;
  period_end: string | null;
  status: string;
  refunded_collected_cents: number;
  reversed_commission_cents: number;
  reversed_at: string | null;
  paid_at: string | null;
  payout_note: string | null;
  created_at: string;
  updated_at: string;
}

function toCreatorCommission(row: CreatorCommissionRow): CreatorCommission {
  return {
    id: row.id,
    creatorId: row.creator_id,
    referralId: row.referral_id,
    businessId: row.business_id,
    stripeInvoiceId: row.stripe_invoice_id,
    stripeChargeId: row.stripe_charge_id ?? undefined,
    collectedAmountCents: row.collected_amount_cents,
    commissionableAmountCents: row.commissionable_amount_cents,
    currency: row.currency,
    commissionRateBps: row.commission_rate_bps,
    commissionAmountCents: row.commission_amount_cents,
    periodStart: row.period_start ?? undefined,
    periodEnd: row.period_end ?? undefined,
    status: row.status as CreatorCommissionStatus,
    refundedCollectedCents: row.refunded_collected_cents,
    reversedCommissionCents: row.reversed_commission_cents,
    reversedAt: row.reversed_at ?? undefined,
    paidAt: row.paid_at ?? undefined,
    payoutNote: row.payout_note ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateCreatorCommissionInput {
  creatorId: string;
  referralId: string;
  businessId: string;
  stripeInvoiceId: string;
  stripeChargeId?: string;
  collectedAmountCents: number;
  commissionableAmountCents: number;
  currency: string;
  commissionRateBps: number;
  commissionAmountCents: number;
  periodStart?: string;
  periodEnd?: string;
}

/**
 * The `stripe_invoice_id UNIQUE` constraint (see the migration) is the
 * real idempotency mechanism — callers must catch a unique-violation here
 * as "already processed, this replay is a no-op" (see
 * `isUniqueViolation` in db/pg/client.ts), never retry it as a second
 * insert.
 */
export async function createCreatorCommission(db: Queryable, input: CreateCreatorCommissionInput): Promise<CreatorCommission> {
  const id = makeId("commission");
  const now = new Date().toISOString();
  await db.query(
    `INSERT INTO creator_commissions (
       id, creator_id, referral_id, business_id, stripe_invoice_id, stripe_charge_id,
       collected_amount_cents, commissionable_amount_cents, currency, commission_rate_bps, commission_amount_cents,
       period_start, period_end, status, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'accrued', $14, $14)`,
    [
      id,
      input.creatorId,
      input.referralId,
      input.businessId,
      input.stripeInvoiceId,
      input.stripeChargeId ?? null,
      input.collectedAmountCents,
      input.commissionableAmountCents,
      input.currency,
      input.commissionRateBps,
      input.commissionAmountCents,
      input.periodStart ?? null,
      input.periodEnd ?? null,
      now,
    ],
  );
  const created = await getCreatorCommissionByStripeInvoiceId(db, input.stripeInvoiceId);
  if (!created) throw new Error("Failed to read back the commission that was just created.");
  return created;
}

export async function getCreatorCommissionByStripeInvoiceId(
  db: Queryable,
  stripeInvoiceId: string,
): Promise<CreatorCommission | undefined> {
  const result = await db.query<CreatorCommissionRow>(`SELECT * FROM creator_commissions WHERE stripe_invoice_id = $1`, [
    stripeInvoiceId,
  ]);
  const row = result.rows[0];
  return row ? toCreatorCommission(row) : undefined;
}

export async function getCreatorCommissionById(db: Queryable, id: string): Promise<CreatorCommission | undefined> {
  const result = await db.query<CreatorCommissionRow>(`SELECT * FROM creator_commissions WHERE id = $1`, [id]);
  const row = result.rows[0];
  return row ? toCreatorCommission(row) : undefined;
}

/** Earliest commission's period_start for a referral — used to compute this referral's 12-month (or whatever the creator's current duration is) eligibility cutoff. Superseded by `creator_referrals.commission_window_started_at` for new commissions going forward; retained for any historical row created before that column existed. */
export async function getEarliestCommissionPeriodStart(db: Queryable, referralId: string): Promise<string | undefined> {
  const result = await db.query<{ period_start: string | null }>(
    `SELECT MIN(period_start) AS period_start FROM creator_commissions WHERE referral_id = $1`,
    [referralId],
  );
  return result.rows[0]?.period_start ?? undefined;
}

export interface CommissionTotalsByCreator {
  creatorId: string;
  /** NET of any proportional reversal already applied — see `applyRefundToCommission`. Still-unpaid money actually owed right now, before the holding-period/pending-vs-payable split `services/creators.ts` computes on top of this. */
  accruedCents: number;
  /** The ORIGINAL amount actually paid out — never reduced by a later refund (see `applyRefundToCommission`'s own comment: an already-`'paid'` row's amounts are never touched). Net-of-refund-after-payout is `paidCents + adjustmentCents` (adjustments are negative), computed by the caller alongside `listAdjustmentTotalsByCreator`. */
  paidCents: number;
  /** Fully-reversed commissions (refunded in full) — informational, excluded from both of the above. */
  reversedCents: number;
}

/** Per-creator totals for the admin list/metrics view. `::int` is safe here: a creator's lifetime commission total would need to exceed ~$21M to overflow, far beyond any realistic V1 scale. */
export async function listCommissionTotalsByCreator(db: Queryable): Promise<CommissionTotalsByCreator[]> {
  const result = await db.query<{ creator_id: string; accrued_cents: number; paid_cents: number; reversed_cents: number }>(
    `SELECT creator_id,
       COALESCE(SUM(commission_amount_cents - reversed_commission_cents) FILTER (WHERE status = 'accrued'), 0)::int AS accrued_cents,
       COALESCE(SUM(commission_amount_cents) FILTER (WHERE status = 'paid'), 0)::int AS paid_cents,
       COALESCE(SUM(commission_amount_cents) FILTER (WHERE status = 'reversed'), 0)::int AS reversed_cents
     FROM creator_commissions
     GROUP BY creator_id`,
  );
  return result.rows.map((row) => ({
    creatorId: row.creator_id,
    accruedCents: row.accrued_cents,
    paidCents: row.paid_cents,
    reversedCents: row.reversed_cents,
  }));
}

/** Every commission across every creator — see `services/creators.ts`'s `listCreatorsAdmin`, which reduces this flat list in TypeScript (the same "fetch flat rows, aggregate in JS" pattern `services/admin.ts`'s own dashboard metrics already use) rather than expressing the pending/payable holding-period split as SQL. Fine at V1 scale; revisit if the table ever grows large enough for this to matter. */
export async function listAllCommissions(db: Queryable): Promise<CreatorCommission[]> {
  const result = await db.query<CreatorCommissionRow>(`SELECT * FROM creator_commissions`);
  return result.rows.map(toCreatorCommission);
}

export async function listCommissionsByCreatorId(db: Queryable, creatorId: string): Promise<CreatorCommission[]> {
  const result = await db.query<CreatorCommissionRow>(
    `SELECT * FROM creator_commissions WHERE creator_id = $1 ORDER BY created_at DESC`,
    [creatorId],
  );
  return result.rows.map(toCreatorCommission);
}

export async function listCommissionsByReferralId(db: Queryable, referralId: string): Promise<CreatorCommission[]> {
  const result = await db.query<CreatorCommissionRow>(
    `SELECT * FROM creator_commissions WHERE referral_id = $1 ORDER BY created_at DESC`,
    [referralId],
  );
  return result.rows.map(toCreatorCommission);
}

/** All commissions whose underlying Stripe charge matches — used to find the commission(s) a `charge.refunded` event applies to (a charge maps to at most one invoice/commission in practice, but this returns a list rather than assuming it). */
export async function listCommissionsByStripeChargeId(db: Queryable, stripeChargeId: string): Promise<CreatorCommission[]> {
  const result = await db.query<CreatorCommissionRow>(`SELECT * FROM creator_commissions WHERE stripe_charge_id = $1`, [
    stripeChargeId,
  ]);
  return result.rows.map(toCreatorCommission);
}

export interface RefundApplicationResult {
  commission: CreatorCommission;
  /** The NEW reversal this call represents, beyond whatever was already reversed — `0` for an exact replay or a cumulative total that hasn't grown, which is exactly what makes this idempotent against webhook replay and safe across multiple partial refunds (see `services/creatorCommissions.ts`'s `processChargeRefunded`). */
  incrementalReversalCents: number;
  /** Whether this commission's status was already `'paid'` BEFORE this call — the caller uses this to decide whether to record a `creator_commission_adjustments` ledger entry instead of relying on this row's own (deliberately untouched, for a paid row) amounts. */
  wasAlreadyPaid: boolean;
}

/**
 * Applies a NEW cumulative refunded-amount total (Stripe's own
 * `charge.amount_refunded`, always cumulative, never a per-event delta)
 * to one commission. `reversedCommissionCents` is always fully
 * RE-DERIVED from the cumulative refunded total (`round(refunded *
 * rate / 10000)`, capped at `commissionAmountCents`) rather than
 * incremented — this is what makes a second, later partial refund
 * compute a strictly larger (but still capped) total reversal, and what
 * makes an exact replay of the same event recompute the IDENTICAL
 * value rather than double-applying anything.
 *
 * An already-`'paid'` commission's `status`/`paidAt`/`commissionAmountCents`
 * are NEVER touched here — only the tracking columns (`refundedCollectedCents`/
 * `reversedCommissionCents`) update, preserving the real historical
 * payout record. See this function's caller for how `wasAlreadyPaid`
 * is used to record a separate ledger adjustment for that case instead.
 * An `'accrued'` row transitions to `'reversed'` only once FULLY
 * reversed; a merely partial reversal leaves it `'accrued'` (still
 * something owed, just less).
 */
export async function applyRefundToCommission(
  db: Queryable,
  id: string,
  newCumulativeRefundedCents: number,
): Promise<RefundApplicationResult | undefined> {
  const existing = await getCreatorCommissionById(db, id);
  if (!existing) return undefined;

  const cappedCumulativeRefunded = Math.max(0, Math.min(newCumulativeRefundedCents, existing.commissionableAmountCents));
  const wasAlreadyPaid = existing.status === "paid";

  if (cappedCumulativeRefunded <= existing.refundedCollectedCents) {
    return { commission: existing, incrementalReversalCents: 0, wasAlreadyPaid };
  }

  const newReversedCommissionCents = Math.min(
    existing.commissionAmountCents,
    Math.round((cappedCumulativeRefunded * existing.commissionRateBps) / 10_000),
  );
  const incrementalReversalCents = newReversedCommissionCents - existing.reversedCommissionCents;
  const newStatus =
    existing.status === "accrued" && newReversedCommissionCents >= existing.commissionAmountCents ? "reversed" : existing.status;
  const now = new Date().toISOString();

  await db.query(
    `UPDATE creator_commissions SET
       refunded_collected_cents = $1,
       reversed_commission_cents = $2,
       status = $3,
       reversed_at = CASE WHEN $3 = 'reversed' AND reversed_at IS NULL THEN $4 ELSE reversed_at END,
       updated_at = $4
     WHERE id = $5`,
    [cappedCumulativeRefunded, newReversedCommissionCents, newStatus, now, id],
  );

  const updated = await getCreatorCommissionById(db, id);
  return { commission: updated!, incrementalReversalCents, wasAlreadyPaid };
}

/** Admin-only manual payout marking (see services/creators.ts) — only ever moves an 'accrued' commission to 'paid'; marking an already-'paid' or 'reversed' row is refused by the WHERE clause, surfacing as `rowCount === 0` for the caller to turn into a clear error rather than silently re-stamping `paidAt`. */
export async function markCommissionPaid(db: Queryable, id: string, payoutNote: string | undefined): Promise<CreatorCommission | undefined> {
  const now = new Date().toISOString();
  const result = await db.query(
    `UPDATE creator_commissions SET status = 'paid', paid_at = $1, payout_note = $2, updated_at = $1 WHERE id = $3 AND status = 'accrued'`,
    [now, payoutNote ?? null, id],
  );
  if (result.rowCount === 0) return undefined;
  return getCreatorCommissionById(db, id);
}
