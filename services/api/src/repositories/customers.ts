import type { DatabaseSync } from "node:sqlite";
import type { Customer, CustomerInput } from "@tallyvis/types";
import { makeId } from "../db/ids";

interface CustomerRow {
  id: string;
  business_id: string;
  name: string;
  email: string;
  phone: string | null;
  address: string | null;
  created_at: string;
  updated_at: string;
}

function toCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    businessId: row.business_id,
    name: row.name,
    email: row.email,
    phone: row.phone ?? undefined,
    address: row.address ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Every query below is scoped by `businessId` — the multi-tenant boundary — never by `id` alone. */

export function createCustomer(db: DatabaseSync, businessId: string, input: CustomerInput): Customer {
  const id = makeId("customer");
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO customers (id, business_id, name, email, phone, address, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
  ).run(id, businessId, input.name, input.email, input.phone ?? null, now, now);
  return toCustomer({
    id,
    business_id: businessId,
    name: input.name,
    email: input.email,
    phone: input.phone ?? null,
    address: null,
    created_at: now,
    updated_at: now,
  });
}

/** Finds an existing customer for this business by email (case-insensitive), so quoting the same person twice doesn't fork into two customer records. */
export function findCustomerByEmail(
  db: DatabaseSync,
  businessId: string,
  email: string,
): Customer | undefined {
  const row = db
    .prepare(`SELECT * FROM customers WHERE business_id = ? AND lower(email) = lower(?)`)
    .get(businessId, email) as CustomerRow | undefined;
  return row ? toCustomer(row) : undefined;
}

export function getCustomerById(
  db: DatabaseSync,
  businessId: string,
  id: string,
): Customer | undefined {
  const row = db
    .prepare(`SELECT * FROM customers WHERE id = ? AND business_id = ?`)
    .get(id, businessId) as CustomerRow | undefined;
  return row ? toCustomer(row) : undefined;
}

export function listCustomers(db: DatabaseSync, businessId: string): Customer[] {
  const rows = db
    .prepare(`SELECT * FROM customers WHERE business_id = ? ORDER BY created_at DESC`)
    .all(businessId) as unknown as CustomerRow[];
  return rows.map(toCustomer);
}

export function updateCustomer(
  db: DatabaseSync,
  businessId: string,
  id: string,
  input: CustomerInput,
): Customer | undefined {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE customers SET name = ?, email = ?, phone = ?, updated_at = ? WHERE id = ? AND business_id = ?`,
    )
    .run(input.name, input.email, input.phone ?? null, now, id, businessId);
  if (result.changes === 0) return undefined;
  return getCustomerById(db, businessId, id);
}
