import { makeId } from "../db/ids";
import type { Queryable } from "../db/pg/client";

/**
 * A ledger of adjustments against a creator's FUTURE payable balance —
 * see db/pg/migrations/0016_creator_program_v1_1.sql's own comment.
 * Created ONLY when a refund arrives for a commission already marked
 * `'paid'` (see `services/creatorCommissions.ts`'s `processChargeRefunded`)
 * — the one case where the commission row itself is deliberately never
 * touched, so this is the complete record of why a creator's effective
 * balance differs from the simple sum of their commission rows.
 */
export type CreatorCommissionAdjustmentReason = "refund_after_payout" | "manual";

export interface CreatorCommissionAdjustment {
  id: string;
  commissionId: string;
  creatorId: string;
  /** Negative = money owed back by the creator, netted against their next payout. */
  amountCents: number;
  reason: CreatorCommissionAdjustmentReason;
  note: string;
  createdAt: string;
}

interface CreatorCommissionAdjustmentRow {
  id: string;
  commission_id: string;
  creator_id: string;
  amount_cents: number;
  reason: string;
  note: string;
  created_at: string;
}

function toAdjustment(row: CreatorCommissionAdjustmentRow): CreatorCommissionAdjustment {
  return {
    id: row.id,
    commissionId: row.commission_id,
    creatorId: row.creator_id,
    amountCents: row.amount_cents,
    reason: row.reason as CreatorCommissionAdjustmentReason,
    note: row.note,
    createdAt: row.created_at,
  };
}

export interface CreateCommissionAdjustmentInput {
  commissionId: string;
  creatorId: string;
  amountCents: number;
  reason: CreatorCommissionAdjustmentReason;
  note?: string;
}

export async function createCommissionAdjustment(db: Queryable, input: CreateCommissionAdjustmentInput): Promise<CreatorCommissionAdjustment> {
  const id = makeId("adjustment");
  const now = new Date().toISOString();
  await db.query(
    `INSERT INTO creator_commission_adjustments (id, commission_id, creator_id, amount_cents, reason, note, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, input.commissionId, input.creatorId, input.amountCents, input.reason, input.note ?? "", now],
  );
  const result = await db.query<CreatorCommissionAdjustmentRow>(`SELECT * FROM creator_commission_adjustments WHERE id = $1`, [id]);
  return toAdjustment(result.rows[0]!);
}

export async function listAdjustmentsByCreatorId(db: Queryable, creatorId: string): Promise<CreatorCommissionAdjustment[]> {
  const result = await db.query<CreatorCommissionAdjustmentRow>(
    `SELECT * FROM creator_commission_adjustments WHERE creator_id = $1 ORDER BY created_at DESC`,
    [creatorId],
  );
  return result.rows.map(toAdjustment);
}

export async function listAdjustmentsByCommissionId(db: Queryable, commissionId: string): Promise<CreatorCommissionAdjustment[]> {
  const result = await db.query<CreatorCommissionAdjustmentRow>(
    `SELECT * FROM creator_commission_adjustments WHERE commission_id = $1 ORDER BY created_at DESC`,
    [commissionId],
  );
  return result.rows.map(toAdjustment);
}

export interface AdjustmentTotalByCreator {
  creatorId: string;
  /** Always <= 0 in practice (every adjustment reason currently produced is a refund-after-payout debit) — summed here as a plain total, not clamped, so a future `'manual'` positive adjustment (not currently created anywhere) would already net correctly without a code change. */
  adjustmentCents: number;
}

export async function listAdjustmentTotalsByCreator(db: Queryable): Promise<AdjustmentTotalByCreator[]> {
  const result = await db.query<{ creator_id: string; adjustment_cents: number }>(
    `SELECT creator_id, COALESCE(SUM(amount_cents), 0)::int AS adjustment_cents FROM creator_commission_adjustments GROUP BY creator_id`,
  );
  return result.rows.map((row) => ({ creatorId: row.creator_id, adjustmentCents: row.adjustment_cents }));
}
