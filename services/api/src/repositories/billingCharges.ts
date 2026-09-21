import type { DatabaseSync } from "node:sqlite";
import { makeId } from "../db/ids";

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

export function getBillingChargeByKind(
  db: DatabaseSync,
  businessId: string,
  kind: BillingChargeKind,
): BillingCharge | undefined {
  const row = db
    .prepare(`SELECT * FROM billing_charges WHERE business_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 1`)
    .get(businessId, kind) as BillingChargeRow | undefined;
  return row ? toCharge(row) : undefined;
}

/** Looked up by the Stripe webhook handler for a one-time (payment-mode) checkout, which knows the charge id round-tripped through Checkout metadata, not which business it belongs to until this resolves it. */
export function getBillingChargeById(db: DatabaseSync, id: string): BillingCharge | undefined {
  const row = db.prepare(`SELECT * FROM billing_charges WHERE id = ?`).get(id) as BillingChargeRow | undefined;
  return row ? toCharge(row) : undefined;
}

export function listBillingCharges(db: DatabaseSync, businessId: string): BillingCharge[] {
  const rows = db
    .prepare(`SELECT * FROM billing_charges WHERE business_id = ? ORDER BY created_at DESC`)
    .all(businessId) as unknown as BillingChargeRow[];
  return rows.map(toCharge);
}

export function createBillingCharge(
  db: DatabaseSync,
  businessId: string,
  input: { kind: BillingChargeKind; amountCents: number; currency: string; status?: BillingChargeStatus },
): BillingCharge {
  const id = makeId("charge");
  const now = new Date().toISOString();
  const status = input.status ?? "pending";
  db.prepare(
    `INSERT INTO billing_charges (id, business_id, kind, status, amount_cents, currency, provider_charge_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
  ).run(id, businessId, input.kind, status, input.amountCents, input.currency, now, now);
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

export function markBillingChargeStatus(
  db: DatabaseSync,
  id: string,
  status: BillingChargeStatus,
  providerChargeId?: string,
): void {
  db.prepare(`UPDATE billing_charges SET status = ?, provider_charge_id = COALESCE(?, provider_charge_id), updated_at = ? WHERE id = ?`).run(
    status,
    providerChargeId ?? null,
    new Date().toISOString(),
    id,
  );
}
