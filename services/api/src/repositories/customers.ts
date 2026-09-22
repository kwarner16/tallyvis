import type { Customer, CustomerInput } from "@tallyvis/types";
import { makeId } from "../db/ids";
import type { Queryable } from "../db/pg/client";

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

export async function createCustomer(db: Queryable, businessId: string, input: CustomerInput): Promise<Customer> {
  const id = makeId("customer");
  const now = new Date().toISOString();
  await db.query(
    `INSERT INTO customers (id, business_id, name, email, phone, address, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NULL, $6, $6)`,
    [id, businessId, input.name, input.email, input.phone ?? null, now],
  );
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
export async function findCustomerByEmail(
  db: Queryable,
  businessId: string,
  email: string,
): Promise<Customer | undefined> {
  const result = await db.query<CustomerRow>(
    `SELECT * FROM customers WHERE business_id = $1 AND lower(email) = lower($2)`,
    [businessId, email],
  );
  const row = result.rows[0];
  return row ? toCustomer(row) : undefined;
}

export async function getCustomerById(
  db: Queryable,
  businessId: string,
  id: string,
): Promise<Customer | undefined> {
  const result = await db.query<CustomerRow>(
    `SELECT * FROM customers WHERE id = $1 AND business_id = $2`,
    [id, businessId],
  );
  const row = result.rows[0];
  return row ? toCustomer(row) : undefined;
}

export async function listCustomers(db: Queryable, businessId: string): Promise<Customer[]> {
  const result = await db.query<CustomerRow>(
    `SELECT * FROM customers WHERE business_id = $1 ORDER BY created_at DESC`,
    [businessId],
  );
  return result.rows.map(toCustomer);
}

export async function updateCustomer(
  db: Queryable,
  businessId: string,
  id: string,
  input: CustomerInput,
): Promise<Customer | undefined> {
  const now = new Date().toISOString();
  const result = await db.query(
    `UPDATE customers SET name = $1, email = $2, phone = $3, updated_at = $4 WHERE id = $5 AND business_id = $6`,
    [input.name, input.email, input.phone ?? null, now, id, businessId],
  );
  if (result.rowCount === 0) return undefined;
  return getCustomerById(db, businessId, id);
}
