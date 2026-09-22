import { makeId } from "../db/ids";
import type { Queryable } from "../db/pg/client";

/**
 * Phase 14 — one-time charges (e.g. the website installation fee),
 * deliberately modeled separately from `subscriptions`, which only ever
 * represents the RECURRING plan. See
 * docs/decisions/0016-onboarding-billing-embed.md.
 */

export type BillingChargeKind = "website_installation";
export type BillingChargeStatus = "pending" | "paid" | "waived";

export interface BillingCharge {
  id: string;
  businessId: string;
  kind: BillingChargeKind;
  status: BillingChargeStatus;
  amountCents: number;
  currency: string;
  providerChargeId?: string;
  createdAt: string;
  updatedAt: string;
}

interface BillingChargeRow {
  id: string;
  business_id: string;
  kind: string;
  status: string;
  amount_cents: number;
  currency: string;
  provider_charge_id: string | null;
  created_at: string;
  updated_at: string;
}

function toCharge(row: BillingChargeRow): BillingCharge {
  return {
    id: row.id,
    businessId: row.business_id,
    kind: row.kind as BillingChargeKind,
    status: row.status as BillingChargeStatus,
    amountCents: row.amount_cents,
    currency: row.currency,
    providerChargeId: row.provider_charge_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getBillingChargeByKind(
  db: Queryable,
  businessId: string,
  kind: BillingChargeKind,
): Promise<BillingCharge | undefined> {
  const result = await db.query<BillingChargeRow>(
    `SELECT * FROM billing_charges WHERE business_id = $1 AND kind = $2 ORDER BY created_at DESC LIMIT 1`,
    [businessId, kind],
  );
  const row = result.rows[0];
  return row ? toCharge(row) : undefined;
}

/** Looked up by the Stripe webhook handler for a one-time (payment-mode) checkout, which knows the charge id round-tripped through Checkout metadata, not which business it belongs to until this resolves it. */
export async function getBillingChargeById(db: Queryable, id: string): Promise<BillingCharge | undefined> {
  const result = await db.query<BillingChargeRow>(`SELECT * FROM billing_charges WHERE id = $1`, [id]);
  const row = result.rows[0];
  return row ? toCharge(row) : undefined;
}

export async function listBillingCharges(db: Queryable, businessId: string): Promise<BillingCharge[]> {
  const result = await db.query<BillingChargeRow>(
    `SELECT * FROM billing_charges WHERE business_id = $1 ORDER BY created_at DESC`,
    [businessId],
  );
  return result.rows.map(toCharge);
}

export async function createBillingCharge(
  db: Queryable,
  businessId: string,
  input: { kind: BillingChargeKind; amountCents: number; currency: string; status?: BillingChargeStatus },
): Promise<BillingCharge> {
  const id = makeId("charge");
  const now = new Date().toISOString();
  const status = input.status ?? "pending";
  await db.query(
    `INSERT INTO billing_charges (id, business_id, kind, status, amount_cents, currency, provider_charge_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $7)`,
    [id, businessId, input.kind, status, input.amountCents, input.currency, now],
  );
  return {
    id,
    businessId,
    kind: input.kind,
    status,
    amountCents: input.amountCents,
    currency: input.currency,
    createdAt: now,
    updatedAt: now,
  };
}

export async function markBillingChargeStatus(
  db: Queryable,
  id: string,
  status: BillingChargeStatus,
  providerChargeId?: string,
): Promise<void> {
  await db.query(
    `UPDATE billing_charges SET status = $1, provider_charge_id = COALESCE($2, provider_charge_id), updated_at = $3 WHERE id = $4`,
    [status, providerChargeId ?? null, new Date().toISOString(), id],
  );
}
