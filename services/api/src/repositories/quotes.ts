import type {
  Estimate,
  Property,
  PropertyAnalysisResult,
  Quote,
  QuoteStatus,
  ServicePreferences,
} from "@tallyvis/types";
import type { RawPropertyObservation } from "@tallyvis/ai";
import { makeId } from "../db/ids";
import type { Queryable } from "../db/pg/client";

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
  /** Customer interaction/response tracking. Nullable: set only as the corresponding event actually happens. */
  first_viewed_at: string | null;
  last_viewed_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  changes_requested_at: string | null;
  customer_request_note: string | null;
  /** Nullable: only set when AI analysis actually produced the observation this quote was saved with. */
  ai_observation_json: string | null;
  /** The most recent "send quote by email" attempt only, not a history. */
  email_sent_at: string | null;
  email_delivery_status: string | null;
  email_provider_message_id: string | null;
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
      // `property_address` stays a nullable column (see the migration
      // that added it) — required only going forward at the application
      // layer, in `services/quotes.ts`'s `persistPricedQuote`, so a
      // pre-existing NULL from before that requirement never breaks
      // reading an old quote. Surfaced here as "" rather than left
      // optional, matching `Property.address`'s now-required shape.
      address: row.property_address ?? "",
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
    firstViewedAt: row.first_viewed_at ?? undefined,
    lastViewedAt: row.last_viewed_at ?? undefined,
    acceptedAt: row.accepted_at ?? undefined,
    declinedAt: row.declined_at ?? undefined,
    changesRequestedAt: row.changes_requested_at ?? undefined,
    customerRequestNote: row.customer_request_note ?? undefined,
    emailSentAt: row.email_sent_at ?? undefined,
    emailDeliveryStatus: (row.email_delivery_status as Quote["emailDeliveryStatus"]) ?? undefined,
    emailProviderMessageId: row.email_provider_message_id ?? undefined,
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
  /**
   * The AI's raw per-field observation, preserved separately from
   * `analysis` (the human-confirmed final characteristics) so the two can
   * later be compared. Omitted (not merely `undefined`) whenever AI
   * analysis wasn't used to produce this quote — never fabricated after
   * the fact.
   */
  aiObservation?: RawPropertyObservation;
}

/** Every query below is scoped by `businessId` in the WHERE clause itself — not just checked afterward — so a wrong/forged id can never resolve to another tenant's row. */

export async function createQuoteRecord(db: Queryable, businessId: string, input: CreateQuoteRecordInput): Promise<Quote> {
  const id = makeId("quote");
  const now = input.createdAt ?? new Date().toISOString();
  await db.query(
    `INSERT INTO quotes (
       id, business_id, customer_id, pricing_config_id,
       property_type, property_stories, property_address,
       service_preferences_json, notes, photos_json, analysis_json, estimate_json,
       status, created_at, updated_at, ai_observation_json
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [
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
      input.aiObservation ? JSON.stringify(input.aiObservation) : null,
    ],
  );

  const created = await getQuoteById(db, businessId, id);
  if (!created) throw new Error("Failed to read back the quote that was just created.");
  return created;
}

/**
 * The AI's raw per-field observation this quote was saved with, if any —
 * kept separate from `Quote` itself (rather than a field on it) since
 * `packages/types`' `Quote` must not depend on `@tallyvis/ai`'s
 * `RawPropertyObservation` type (see CLAUDE.md's module boundary rules:
 * `packages/types` depends on nothing). Never overwritten after quote
 * creation — there is deliberately no corresponding update function, so a
 * later human correction (`updateQuoteAnalysisAndEstimate`) can never
 * alter what the AI originally observed.
 */
export async function getQuoteAiObservation(
  db: Queryable,
  businessId: string,
  id: string,
): Promise<RawPropertyObservation | undefined> {
  const result = await db.query<{ ai_observation_json: string | null }>(
    `SELECT ai_observation_json FROM quotes WHERE id = $1 AND business_id = $2`,
    [id, businessId],
  );
  const row = result.rows[0];
  if (!row?.ai_observation_json) return undefined;
  return JSON.parse(row.ai_observation_json) as RawPropertyObservation;
}

/**
 * Every AI observation this business's quotes were saved with, keyed by
 * quote id — used to annotate a whole list of quotes (e.g. the job-outcomes
 * view) without an N+1 query per row. Quotes with no AI observation are
 * simply absent from the map, not present with an empty value.
 */
export async function listAiObservationsByQuoteId(
  db: Queryable,
  businessId: string,
): Promise<Map<string, RawPropertyObservation>> {
  const result = await db.query<{ id: string; ai_observation_json: string }>(
    `SELECT id, ai_observation_json FROM quotes WHERE business_id = $1 AND ai_observation_json IS NOT NULL`,
    [businessId],
  );
  return new Map(result.rows.map((row) => [row.id, JSON.parse(row.ai_observation_json) as RawPropertyObservation]));
}

export async function getQuoteById(db: Queryable, businessId: string, id: string): Promise<Quote | undefined> {
  const result = await db.query<QuoteRow>(`${SELECT_QUOTE_WITH_CUSTOMER} WHERE q.id = $1 AND q.business_id = $2`, [
    id,
    businessId,
  ]);
  const row = result.rows[0];
  return row ? toQuote(row) : undefined;
}

export async function listQuotes(db: Queryable, businessId: string): Promise<Quote[]> {
  const result = await db.query<QuoteRow>(
    `${SELECT_QUOTE_WITH_CUSTOMER} WHERE q.business_id = $1 ORDER BY q.created_at DESC`,
    [businessId],
  );
  return result.rows.map(toQuote);
}

/** Updates the job characteristics and the freshly-computed estimate together — callers decide which pricing configuration priced it and whether `pricingConfigId` changes. */
export async function updateQuoteAnalysisAndEstimate(
  db: Queryable,
  businessId: string,
  id: string,
  analysis: PropertyAnalysisResult,
  estimate: Estimate,
  pricingConfigId: string,
): Promise<Quote | undefined> {
  const now = new Date().toISOString();
  const result = await db.query(
    `UPDATE quotes SET analysis_json = $1, estimate_json = $2, pricing_config_id = $3, updated_at = $4
     WHERE id = $5 AND business_id = $6`,
    [JSON.stringify(analysis), JSON.stringify(estimate), pricingConfigId, now, id, businessId],
  );
  if (result.rowCount === 0) return undefined;
  return getQuoteById(db, businessId, id);
}

/**
 * The public estimator's re-analysis counterpart to
 * `updateQuoteAnalysisAndEstimate` — used when a customer improves their
 * own submission (e.g. adds another photo after landing on
 * `/estimate/result`) rather than a business manually correcting a field.
 * Unlike the authenticated version, this also re-derives `status` and
 * replaces `ai_observation_json`: a customer-driven re-analysis can
 * genuinely resolve the evidence gap that put the quote in `needs_review`
 * in the first place, which a business's own manual edit never implies
 * (2026-09 incident audit — see docs/decisions/0025 for the "improved
 * analysis was silently discarded, business saw a stale first-pass quote
 * forever" bug this closes).
 */
export async function updateQuoteFromReanalysis(
  db: Queryable,
  businessId: string,
  id: string,
  analysis: PropertyAnalysisResult,
  estimate: Estimate,
  pricingConfigId: string,
  status: QuoteStatus,
  aiObservation: RawPropertyObservation | undefined,
): Promise<Quote | undefined> {
  const now = new Date().toISOString();
  const result = await db.query(
    `UPDATE quotes SET analysis_json = $1, estimate_json = $2, pricing_config_id = $3, status = $4, ai_observation_json = $5, updated_at = $6
     WHERE id = $7 AND business_id = $8`,
    [
      JSON.stringify(analysis),
      JSON.stringify(estimate),
      pricingConfigId,
      status,
      aiObservation ? JSON.stringify(aiObservation) : null,
      now,
      id,
      businessId,
    ],
  );
  if (result.rowCount === 0) return undefined;
  return getQuoteById(db, businessId, id);
}

export async function updateQuoteCustomerId(
  db: Queryable,
  businessId: string,
  id: string,
  customerId: string,
): Promise<Quote | undefined> {
  const now = new Date().toISOString();
  const result = await db.query(`UPDATE quotes SET customer_id = $1, updated_at = $2 WHERE id = $3 AND business_id = $4`, [
    customerId,
    now,
    id,
    businessId,
  ]);
  if (result.rowCount === 0) return undefined;
  return getQuoteById(db, businessId, id);
}

/**
 * Also stamps `accepted_at`/`declined_at` the first (and, since both are
 * terminal in `QUOTE_STATUS_TRANSITIONS`, only) time the status actually
 * becomes that value — the `COALESCE` means an already-set timestamp is
 * never overwritten, so it stays the moment of the real event even if this
 * function is ever called again for an unrelated status change.
 */
export async function updateQuoteStatus(db: Queryable, businessId: string, id: string, status: QuoteStatus): Promise<Quote | undefined> {
  const now = new Date().toISOString();
  const result = await db.query(
    `UPDATE quotes SET
       status = $1,
       updated_at = $2,
       accepted_at = COALESCE($3, accepted_at),
       declined_at = COALESCE($4, declined_at)
     WHERE id = $5 AND business_id = $6`,
    [status, now, status === "accepted" ? now : null, status === "declined" ? now : null, id, businessId],
  );
  if (result.rowCount === 0) return undefined;
  return getQuoteById(db, businessId, id);
}

/** Records that the quote was viewed — `first_viewed_at` is set only once (via `COALESCE`), `last_viewed_at` every time. Called on every successful share-token resolution, so a business can tell whether its customer has looked at the quote at all. */
export async function recordQuoteViewed(db: Queryable, businessId: string, id: string): Promise<void> {
  const now = new Date().toISOString();
  await db.query(
    `UPDATE quotes SET first_viewed_at = COALESCE(first_viewed_at, $1), last_viewed_at = $1
     WHERE id = $2 AND business_id = $3`,
    [now, id, businessId],
  );
}

/** The customer's free-text "request changes" note — this always reflects the most recent request, not a history of every one; see docs/decisions/0012-secure-quote-sharing.md for why a single note fits this phase rather than a separate messages table. */
export async function recordQuoteChangeRequest(db: Queryable, businessId: string, id: string, note: string): Promise<Quote | undefined> {
  const now = new Date().toISOString();
  const result = await db.query(
    `UPDATE quotes SET changes_requested_at = $1, customer_request_note = $2, updated_at = $3
     WHERE id = $4 AND business_id = $5`,
    [now, note, now, id, businessId],
  );
  if (result.rowCount === 0) return undefined;
  return getQuoteById(db, businessId, id);
}

/** Records the most recent "send quote by email" attempt — a single slot, not a history, the same pattern as `recordQuoteChangeRequest`. Doesn't bump `updated_at` — sending an email isn't a change to the quote's own content, the same reasoning `recordQuoteViewed` already applies to view tracking. */
export async function recordQuoteEmailAttempt(
  db: Queryable,
  businessId: string,
  id: string,
  status: "sent" | "failed",
  providerMessageId: string | undefined,
): Promise<void> {
  await db.query(
    `UPDATE quotes SET email_sent_at = $1, email_delivery_status = $2, email_provider_message_id = $3
     WHERE id = $4 AND business_id = $5`,
    [new Date().toISOString(), status, providerMessageId ?? null, id, businessId],
  );
}
