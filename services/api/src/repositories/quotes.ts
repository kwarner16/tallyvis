import type { DatabaseSync } from "node:sqlite";
import type {
  Estimate,
  Property,
  PropertyAnalysisResult,
  Quote,
  QuoteStatus,
  ServicePreferences,
} from "@tallyvis/types";
import { makeId } from "../db/ids";

/**
 * Every quote row is hydrated with a JOIN to its customer, so the returned
 * `Quote` still carries `quote.customer.*` the way every existing UI
 * component expects — see the `Quote` type's own comment in
 * packages/types. `customerId` is the real column driving the join and the
 * multi-tenant scoping; `customer` is a read convenience, never written
 * back independently.
 */
interface QuoteRow {
  id: string;
  business_id: string;
  customer_id: string;
  pricing_config_id: string;
  property_type: string;
  property_stories: number;
  property_address: string | null;
  service_preferences_json: string;
  notes: string;
  photos_json: string;
  analysis_json: string;
  estimate_json: string;
  status: string;
  created_at: string;
  updated_at: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  customer_address: string | null;
  customer_created_at: string;
  customer_updated_at: string;
}

const SELECT_QUOTE_WITH_CUSTOMER = `
  SELECT
    q.*,
    c.name AS customer_name,
    c.email AS customer_email,
    c.phone AS customer_phone,
    c.address AS customer_address,
    c.created_at AS customer_created_at,
    c.updated_at AS customer_updated_at
  FROM quotes q
  JOIN customers c ON c.id = q.customer_id
`;

function toQuote(row: QuoteRow): Quote {
  return {
    id: row.id,
    businessId: row.business_id,
    customerId: row.customer_id,
    customer: {
      id: row.customer_id,
      businessId: row.business_id,
      name: row.customer_name,
      email: row.customer_email,
      phone: row.customer_phone ?? undefined,
      address: row.customer_address ?? undefined,
      createdAt: row.customer_created_at,
      updatedAt: row.customer_updated_at,
    },
    property: {
      propertyType: row.property_type as Property["propertyType"],
      stories: row.property_stories,
      address: row.property_address ?? undefined,
    },
    servicePreferences: JSON.parse(row.service_preferences_json) as ServicePreferences,
    notes: row.notes,
    photos: JSON.parse(row.photos_json) as Quote["photos"],
    analysis: JSON.parse(row.analysis_json) as PropertyAnalysisResult,
    estimate: JSON.parse(row.estimate_json) as Estimate,
    pricingConfigId: row.pricing_config_id,
    status: row.status as QuoteStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateQuoteRecordInput {
  customerId: string;
  pricingConfigId: string;
  property: Property;
  servicePreferences: ServicePreferences;
  notes: string;
  photos: Quote["photos"];
  analysis: PropertyAnalysisResult;
  estimate: Estimate;
  status: QuoteStatus;
  /** Override for seeding realistic-looking historical demo data only — production callers always get "now". */
  createdAt?: string;
}

/** Every query below is scoped by `businessId` in the WHERE clause itself — not just checked afterward — so a wrong/forged id can never resolve to another tenant's row. */

export function createQuoteRecord(db: DatabaseSync, businessId: string, input: CreateQuoteRecordInput): Quote {
  const id = makeId("quote");
  const now = input.createdAt ?? new Date().toISOString();
  db.prepare(
    `INSERT INTO quotes (
       id, business_id, customer_id, pricing_config_id,
       property_type, property_stories, property_address,
       service_preferences_json, notes, photos_json, analysis_json, estimate_json,
       status, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    businessId,
    input.customerId,
    input.pricingConfigId,
    input.property.propertyType,
    input.property.stories,
    input.property.address ?? null,
    JSON.stringify(input.servicePreferences),
    input.notes,
    JSON.stringify(input.photos),
    JSON.stringify(input.analysis),
    JSON.stringify(input.estimate),
    input.status,
    now,
    now,
  );

  const created = getQuoteById(db, businessId, id);
  if (!created) throw new Error("Failed to read back the quote that was just created.");
  return created;
}

export function getQuoteById(db: DatabaseSync, businessId: string, id: string): Quote | undefined {
  const row = db
    .prepare(`${SELECT_QUOTE_WITH_CUSTOMER} WHERE q.id = ? AND q.business_id = ?`)
    .get(id, businessId) as QuoteRow | undefined;
  return row ? toQuote(row) : undefined;
}

/** No business_id filter — only for the public, read-only `/quote/[id]` view. See `services/quotes.ts`'s `getQuotePublic`. */
export function getQuoteByIdAnyBusiness(db: DatabaseSync, id: string): Quote | undefined {
  const row = db.prepare(`${SELECT_QUOTE_WITH_CUSTOMER} WHERE q.id = ?`).get(id) as
    | QuoteRow
    | undefined;
  return row ? toQuote(row) : undefined;
}

export function listQuotes(db: DatabaseSync, businessId: string): Quote[] {
  const rows = db
    .prepare(`${SELECT_QUOTE_WITH_CUSTOMER} WHERE q.business_id = ? ORDER BY q.created_at DESC`)
    .all(businessId) as unknown as QuoteRow[];
  return rows.map(toQuote);
}

/** Updates the job characteristics and the freshly-computed estimate together — callers decide which pricing configuration priced it and whether `pricingConfigId` changes. */
export function updateQuoteAnalysisAndEstimate(
  db: DatabaseSync,
  businessId: string,
  id: string,
  analysis: PropertyAnalysisResult,
  estimate: Estimate,
  pricingConfigId: string,
): Quote | undefined {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE quotes SET analysis_json = ?, estimate_json = ?, pricing_config_id = ?, updated_at = ?
       WHERE id = ? AND business_id = ?`,
    )
    .run(JSON.stringify(analysis), JSON.stringify(estimate), pricingConfigId, now, id, businessId);
  if (result.changes === 0) return undefined;
  return getQuoteById(db, businessId, id);
}

export function updateQuoteCustomerId(
  db: DatabaseSync,
  businessId: string,
  id: string,
  customerId: string,
): Quote | undefined {
  const now = new Date().toISOString();
  const result = db
    .prepare(`UPDATE quotes SET customer_id = ?, updated_at = ? WHERE id = ? AND business_id = ?`)
    .run(customerId, now, id, businessId);
  if (result.changes === 0) return undefined;
  return getQuoteById(db, businessId, id);
}

export function updateQuoteStatus(
  db: DatabaseSync,
  businessId: string,
  id: string,
  status: QuoteStatus,
): Quote | undefined {
  const now = new Date().toISOString();
  const result = db
    .prepare(`UPDATE quotes SET status = ?, updated_at = ? WHERE id = ? AND business_id = ?`)
    .run(status, now, id, businessId);
  if (result.changes === 0) return undefined;
  return getQuoteById(db, businessId, id);
}
