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
  sms_consent: boolean;
  sms_consent_at: string | null;
  sms_consent_source: string | null;
  sms_consent_disclosure_version: string | null;
  sms_opted_out_at: string | null;
  sms_reopted_in_at: string | null;
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
    smsConsent: row.sms_consent,
    smsConsentAt: row.sms_consent_at ?? undefined,
    smsConsentSource: row.sms_consent_source ?? undefined,
    smsConsentDisclosureVersion: row.sms_consent_disclosure_version ?? undefined,
    smsOptedOutAt: row.sms_opted_out_at ?? undefined,
    smsReoptedInAt: row.sms_reopted_in_at ?? undefined,
  };
}

/**
 * The extra fields only the SERVICE layer may set — never forwarded
 * directly from a caller's `CustomerInput` (see that type's own comment).
 * `source`/`disclosureVersion` are only meaningful (and only ever passed)
 * alongside `input.smsConsent === true`; this repository function is the
 * one place `sms_consent_at` is actually stamped, always from the
 * server's own clock, never a client-supplied timestamp.
 */
export interface CreateCustomerInput extends CustomerInput {
  smsConsentSource?: string;
  smsConsentDisclosureVersion?: string;
}

/** Every query below is scoped by `businessId` — the multi-tenant boundary — never by `id` alone. */

export async function createCustomer(db: Queryable, businessId: string, input: CreateCustomerInput): Promise<Customer> {
  const id = makeId("customer");
  const now = new Date().toISOString();
  const smsConsent = input.smsConsent === true;
  const smsConsentAt = smsConsent ? now : null;
  const smsConsentSource = smsConsent ? input.smsConsentSource ?? null : null;
  const smsConsentDisclosureVersion = smsConsent ? input.smsConsentDisclosureVersion ?? null : null;

  await db.query(
    `INSERT INTO customers (id, business_id, name, email, phone, address, created_at, updated_at, sms_consent, sms_consent_at, sms_consent_source, sms_consent_disclosure_version)
     VALUES ($1, $2, $3, $4, $5, NULL, $6, $6, $7, $8, $9, $10)`,
    [
      id,
      businessId,
      input.name,
      input.email,
      input.phone ?? null,
      now,
      smsConsent,
      smsConsentAt,
      smsConsentSource,
      smsConsentDisclosureVersion,
    ],
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
    sms_consent: smsConsent,
    sms_consent_at: smsConsentAt,
    sms_consent_source: smsConsentSource,
    sms_consent_disclosure_version: smsConsentDisclosureVersion,
    sms_opted_out_at: null,
    sms_reopted_in_at: null,
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

/**
 * Every customer row, across EVERY business, that has a phone on file —
 * deliberately NOT scoped by `businessId` (see `services/smsWebhooks.ts`'s
 * own comment for why a STOP/START event must be applied globally: TallyVis
 * sends all customer-facing SMS from one shared Twilio resource, so the
 * same physical phone number can legitimately appear on customer rows
 * under several different businesses, and Twilio's own carrier-level
 * suppression after a STOP applies to all of them regardless of which
 * business's quote the row came from). Used only by the inbound SMS
 * webhook handler to find every row a given `From` number might match;
 * never exposed to an authenticated business (which only ever sees its own
 * customers via the existing `businessId`-scoped queries above).
 */
export async function listCustomersWithPhone(db: Queryable): Promise<Customer[]> {
  const result = await db.query<CustomerRow>(`SELECT * FROM customers WHERE phone IS NOT NULL AND phone <> ''`);
  return result.rows.map(toCustomer);
}

/**
 * Records a recognized Twilio STOP: flips `sms_consent` to `false` and
 * stamps `sms_opted_out_at`, but deliberately leaves `sms_consent_at`/
 * `sms_consent_source`/`sms_consent_disclosure_version` untouched — see
 * `Customer.smsConsentAt`'s own comment for why that original evidence must
 * survive an opt-out. Safe to call repeatedly for the same customer (a
 * duplicate STOP just re-stamps the same final state).
 */
export async function recordSmsOptOut(db: Queryable, customerId: string, occurredAt: string): Promise<void> {
  await db.query(
    `UPDATE customers SET sms_consent = false, sms_opted_out_at = $2, updated_at = $2 WHERE id = $1`,
    [customerId, occurredAt],
  );
}

/**
 * Records a recognized Twilio START/re-opt-in: flips `sms_consent` back to
 * `true` and stamps `sms_reopted_in_at`. Callers must only invoke this for
 * a customer that has previously opted out (see `smsWebhooks.ts`'s own
 * gating) — this function itself does not re-check that, so it is never
 * called for a customer who was never consented in the first place.
 */
export async function recordSmsReOptIn(db: Queryable, customerId: string, occurredAt: string): Promise<void> {
  await db.query(
    `UPDATE customers SET sms_consent = true, sms_reopted_in_at = $2, updated_at = $2 WHERE id = $1`,
    [customerId, occurredAt],
  );
}
