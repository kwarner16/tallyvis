import { makeId } from "../db/ids";
import type { Queryable } from "../db/pg/client";

export type CreatorCommissionStatus = "accrued" | "reversed" | "paid";

/** One row per commission-eligible Stripe invoice payment — see db/pg/migrations/0015_creator_program.sql's own comment for the full field-by-field reasoning. */
export interface CreatorCommission {
  id: string;
  creatorId: string;
  referralId: string;
  businessId: string;
  stripeInvoiceId: string;
  stripeChargeId?: string;
  collectedAmountCents: number;
  currency: string;
  commissionRateBps: number;
  commissionAmountCents: number;
  periodStart?: string;
  periodEnd?: string;
  status: CreatorCommissionStatus;
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
  currency: string;
  commission_rate_bps: number;
  commission_amount_cents: number;
  period_start: string | null;
  period_end: string | null;
  status: string;
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
    currency: row.currency,
    commissionRateBps: row.commission_rate_bps,
    commissionAmountCents: row.commission_amount_cents,
    periodStart: row.period_start ?? undefined,
    periodEnd: row.period_end ?? undefined,
    status: row.status as CreatorCommissionStatus,
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
       collected_amount_cents, currency, commission_rate_bps, commission_amount_cents,
       period_start, period_end, status, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'accrued', $13, $13)`,
    [
      id,
      input.creatorId,
      input.referralId,
      input.businessId,
      input.stripeInvoiceId,
      input.stripeChargeId ?? null,
      input.collectedAmountCents,
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
  accruedCents: number;
  paidCents: number;
}

/** Per-creator totals for the admin list/metrics view — `reversed` commissions are deliberately excluded from both totals (never actually earned/kept once refunded). `::int` is safe here: a creator's lifetime commission total would need to exceed ~$21M to overflow, far beyond any realistic V1 scale. */
export async function listCommissionTotalsByCreator(db: Queryable): Promise<CommissionTotalsByCreator[]> {
  const result = await db.query<{ creator_id: string; accrued_cents: number; paid_cents: number }>(
    `SELECT creator_id,
       COALESCE(SUM(commission_amount_cents) FILTER (WHERE status = 'accrued'), 0)::int AS accrued_cents,
       COALESCE(SUM(commission_amount_cents) FILTER (WHERE status = 'paid'), 0)::int AS paid_cents
     FROM creator_commissions
     GROUP BY creator_id`,
  );
  return result.rows.map((row) => ({
    creatorId: row.creator_id,
    accruedCents: row.accrued_cents,
    paidCents: row.paid_cents,
  }));
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

/** Only ever moves an 'accrued' row to 'reversed' — an already-'paid' commission is a settled, real-world payment Kyle already made; a refund arriving after that point is a separate reconciliation question for Kyle to handle manually, never something this function silently overwrites. See services/creatorCommissions.ts's own comment on this call site. */
export async function markCommissionReversed(db: Queryable, id: string): Promise<CreatorCommission | undefined> {
  const now = new Date().toISOString();
  const result = await db.query(
    `UPDATE creator_commissions SET status = 'reversed', reversed_at = $1, updated_at = $1 WHERE id = $2 AND status = 'accrued'`,
    [now, id],
  );
  if (result.rowCount === 0) return undefined;
  return getCreatorCommissionById(db, id);
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
