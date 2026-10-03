import { makeId } from "../db/ids";
import type { Queryable } from "../db/pg/client";

/**
 * Sales Call Tracker V1 (internal admin tool — see
 * docs/decisions/0041-sales-call-tracker.md). A sales prospect is never a
 * TallyVis `Business` — this is Kyle's own cold-calling list, kept
 * entirely separate from the customer-facing schema.
 */

export interface SalesProspect {
  id: string;
  businessName: string;
  contactName?: string;
  phone: string;
  /** E.164, or `undefined` if the raw phone couldn't be normalized — see the migration's own comment. */
  normalizedPhone?: string;
  email?: string;
  website?: string;
  city?: string;
  state?: string;
  source?: string;
  createdAt: string;
  updatedAt: string;
}

interface SalesProspectRow {
  id: string;
  business_name: string;
  contact_name: string | null;
  phone: string;
  normalized_phone: string | null;
  email: string | null;
  website: string | null;
  city: string | null;
  state: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
}

function toSalesProspect(row: SalesProspectRow): SalesProspect {
  return {
    id: row.id,
    businessName: row.business_name,
    contactName: row.contact_name ?? undefined,
    phone: row.phone,
    normalizedPhone: row.normalized_phone ?? undefined,
    email: row.email ?? undefined,
    website: row.website ?? undefined,
    city: row.city ?? undefined,
    state: row.state ?? undefined,
    source: row.source ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateSalesProspectInput {
  businessName: string;
  contactName?: string;
  phone: string;
  normalizedPhone?: string;
  email?: string;
  website?: string;
  city?: string;
  state?: string;
  source?: string;
}

export async function createSalesProspect(db: Queryable, input: CreateSalesProspectInput): Promise<SalesProspect> {
  const id = makeId("salesprospect");
  const now = new Date().toISOString();
  await db.query(
    `INSERT INTO sales_prospects
       (id, business_name, contact_name, phone, normalized_phone, email, website, city, state, source, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
    [
      id,
      input.businessName,
      input.contactName ?? null,
      input.phone,
      input.normalizedPhone ?? null,
      input.email ?? null,
      input.website ?? null,
      input.city ?? null,
      input.state ?? null,
      input.source ?? null,
      now,
    ],
  );
  const result = await db.query<SalesProspectRow>(`SELECT * FROM sales_prospects WHERE id = $1`, [id]);
  return toSalesProspect(result.rows[0]!);
}

export async function getSalesProspectById(db: Queryable, id: string): Promise<SalesProspect | undefined> {
  const result = await db.query<SalesProspectRow>(`SELECT * FROM sales_prospects WHERE id = $1`, [id]);
  const row = result.rows[0];
  return row ? toSalesProspect(row) : undefined;
}

/** The sole duplicate-detection lookup — see the migration's own comment on why `normalized_phone` (not name) is the key. */
export async function findSalesProspectByNormalizedPhone(db: Queryable, normalizedPhone: string): Promise<SalesProspect | undefined> {
  const result = await db.query<SalesProspectRow>(`SELECT * FROM sales_prospects WHERE normalized_phone = $1 LIMIT 1`, [normalizedPhone]);
  const row = result.rows[0];
  return row ? toSalesProspect(row) : undefined;
}

/** Batch form of the lookup above — one round trip for an entire pasted import rather than one query per row. */
export async function findSalesProspectsByNormalizedPhones(db: Queryable, normalizedPhones: string[]): Promise<SalesProspect[]> {
  if (normalizedPhones.length === 0) return [];
  const result = await db.query<SalesProspectRow>(`SELECT * FROM sales_prospects WHERE normalized_phone = ANY($1::text[])`, [
    normalizedPhones,
  ]);
  return result.rows.map(toSalesProspect);
}

/** Case-insensitive exact business-name match — used only as a "possible duplicate" signal during import preview, never as the primary key (names vary too much). */
export async function findSalesProspectsByBusinessNames(db: Queryable, businessNames: string[]): Promise<SalesProspect[]> {
  if (businessNames.length === 0) return [];
  const result = await db.query<SalesProspectRow>(
    `SELECT * FROM sales_prospects WHERE lower(business_name) = ANY($1::text[])`,
    [businessNames.map((name) => name.toLowerCase())],
  );
  return result.rows.map(toSalesProspect);
}

export interface UpdateSalesProspectInput {
  businessName?: string;
  contactName?: string | null;
  phone?: string;
  normalizedPhone?: string | null;
  email?: string | null;
  website?: string | null;
  city?: string | null;
  state?: string | null;
  source?: string | null;
}

/** Lets Kyle correct contact info an import got wrong — see services/salesProspects.ts's `updateSalesProspectAdmin`. */
export async function updateSalesProspect(db: Queryable, id: string, input: UpdateSalesProspectInput): Promise<SalesProspect | undefined> {
  const now = new Date().toISOString();
  const result = await db.query(
    `UPDATE sales_prospects SET
       business_name = COALESCE($1, business_name),
       contact_name = COALESCE($2, contact_name),
       phone = COALESCE($3, phone),
       normalized_phone = COALESCE($4, normalized_phone),
       email = COALESCE($5, email),
       website = COALESCE($6, website),
       city = COALESCE($7, city),
       state = COALESCE($8, state),
       updated_at = $9
     WHERE id = $10`,
    [
      input.businessName,
      input.contactName,
      input.phone,
      input.normalizedPhone,
      input.email,
      input.website,
      input.city,
      input.state,
      now,
      id,
    ],
  );
  if (result.rowCount === 0) return undefined;
  return getSalesProspectById(db, id);
}

export interface SalesQueueRow {
  prospect: SalesProspect;
  lastCallAt?: string;
  lastOutcome?: string;
  lastNotes?: string;
  followUpAt?: string;
}

interface SalesQueueRowDb {
  id: string;
  business_name: string;
  contact_name: string | null;
  phone: string;
  normalized_phone: string | null;
  email: string | null;
  website: string | null;
  city: string | null;
  state: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
  last_call_at: string | null;
  last_outcome: string | null;
  last_notes: string | null;
  follow_up_at: string | null;
}

/**
 * Every prospect, enriched with its MOST RECENT call's outcome/notes/
 * follow-up (a correlated subquery per prospect, bounded by this table's
 * own size — the same "single round-trip SQL" shape
 * `repositories/admin.ts`'s business list already uses, not an N+1 loop).
 * Ordering/"what counts as the next appropriate prospect" is decided by
 * the SERVICE layer (`services/salesProspects.ts`), not here — this is
 * just the flat enriched row set.
 */
export async function listSalesQueueRows(db: Queryable): Promise<SalesQueueRow[]> {
  const result = await db.query<SalesQueueRowDb>(
    `SELECT
       p.*,
       c.started_at AS last_call_at,
       c.outcome AS last_outcome,
       c.notes AS last_notes,
       c.follow_up_at AS follow_up_at
     FROM sales_prospects p
     LEFT JOIN LATERAL (
       SELECT started_at, outcome, notes, follow_up_at
       FROM sales_calls
       WHERE prospect_id = p.id AND ended_at IS NOT NULL
       ORDER BY started_at DESC
       LIMIT 1
     ) c ON true
     ORDER BY p.created_at ASC`,
  );
  return result.rows.map((row) => ({
    prospect: toSalesProspect(row),
    lastCallAt: row.last_call_at ?? undefined,
    lastOutcome: row.last_outcome ?? undefined,
    lastNotes: row.last_notes ?? undefined,
    followUpAt: row.follow_up_at ?? undefined,
  }));
}
