import type { DatabaseSync } from "node:sqlite";
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
  /** Customer interaction/response tracking — see 0002_quote_sharing.sql. Nullable: set only as the corresponding event actually happens. */
  first_viewed_at: string | null;
  last_viewed_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  changes_requested_at: string | null;
  customer_request_note: string | null;
  /** Phase 13 — see 0003_job_outcomes.sql. Nullable: only set when AI analysis actually produced the observation this quote was saved with. */
  ai_observation_json: string | null;
  /** Phase 14 — see 0004_accounts_billing_embed.sql. The most recent "send quote by email" attempt only, not a history. */
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
   * Phase 13 (see docs/decisions/0015-job-outcome-tracking.md) — the AI's
   * raw per-field observation, preserved separately from `analysis`
   * (the human-confirmed final characteristics) so the two can later be
   * compared. Omitted (not merely `undefined`) whenever AI analysis wasn't
   * used to produce this quote — never fabricated after the fact.
   */
  aiObservation?: RawPropertyObservation;
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
       status, created_at, updated_at, ai_observation_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    input.aiObservation ? JSON.stringify(input.aiObservation) : null,
  );

  const created = getQuoteById(db, businessId, id);
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
export function getQuoteAiObservation(
  db: DatabaseSync,
  businessId: string,
  id: string,
): RawPropertyObservation | undefined {
  const row = db
    .prepare(`SELECT ai_observation_json FROM quotes WHERE id = ? AND business_id = ?`)
    .get(id, businessId) as { ai_observation_json: string | null } | undefined;
  if (!row?.ai_observation_json) return undefined;
  return JSON.parse(row.ai_observation_json) as RawPropertyObservation;
}

/**
 * Every AI observation this business's quotes were saved with, keyed by
 * quote id — used to annotate a whole list of quotes (e.g. the job-outcomes
 * view) without an N+1 query per row. Quotes with no AI observation are
 * simply absent from the map, not present with an empty value.
 */
export function listAiObservationsByQuoteId(
  db: DatabaseSync,
  businessId: string,
): Map<string, RawPropertyObservation> {
  const rows = db
    .prepare(`SELECT id, ai_observation_json FROM quotes WHERE business_id = ? AND ai_observation_json IS NOT NULL`)
    .all(businessId) as unknown as { id: string; ai_observation_json: string }[];
  return new Map(rows.map((row) => [row.id, JSON.parse(row.ai_observation_json) as RawPropertyObservation]));
}

export function getQuoteById(db: DatabaseSync, businessId: string, id: string): Quote | undefined {
  const row = db
    .prepare(`${SELECT_QUOTE_WITH_CUSTOMER} WHERE q.id = ? AND q.business_id = ?`)
    .get(id, businessId) as QuoteRow | undefined;
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

/**
 * Also stamps `accepted_at`/`declined_at` the first (and, since both are
 * terminal in `QUOTE_STATUS_TRANSITIONS`, only) time the status actually
 * becomes that value — the `COALESCE` means an already-set timestamp is
 * never overwritten, so it stays the moment of the real event even if this
 * function is ever called again for an unrelated status change.
 */
export function updateQuoteStatus(
  db: DatabaseSync,
  businessId: string,
  id: string,
  status: QuoteStatus,
): Quote | undefined {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE quotes SET
         status = ?,
         updated_at = ?,
         accepted_at = COALESCE(?, accepted_at),
         declined_at = COALESCE(?, declined_at)
       WHERE id = ? AND business_id = ?`,
    )
    .run(
      status,
      now,
      status === "accepted" ? now : null,
      status === "declined" ? now : null,
      id,
      businessId,
    );
  if (result.changes === 0) return undefined;
  return getQuoteById(db, businessId, id);
}

/** Records that the quote was viewed — `first_viewed_at` is set only once (via `COALESCE`), `last_viewed_at` every time. Called on every successful share-token resolution, so a business can tell whether its customer has looked at the quote at all. */
export function recordQuoteViewed(db: DatabaseSync, businessId: string, id: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE quotes SET first_viewed_at = COALESCE(first_viewed_at, ?), last_viewed_at = ?
     WHERE id = ? AND business_id = ?`,
  ).run(now, now, id, businessId);
}

/** The customer's free-text "request changes" note — this always reflects the most recent request, not a history of every one; see docs/decisions/0012-secure-quote-sharing.md for why a single note fits this phase rather than a separate messages table. */
export function recordQuoteChangeRequest(
  db: DatabaseSync,
  businessId: string,
  id: string,
  note: string,
): Quote | undefined {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE quotes SET changes_requested_at = ?, customer_request_note = ?, updated_at = ?
       WHERE id = ? AND business_id = ?`,
    )
    .run(now, note, now, id, businessId);
  if (result.changes === 0) return undefined;
  return getQuoteById(db, businessId, id);
}

/** Records the most recent "send quote by email" attempt — a single slot, not a history, the same pattern as `recordQuoteChangeRequest`; see 0004_accounts_billing_embed.sql. Doesn't bump `updated_at` — sending an email isn't a change to the quote's own content, the same reasoning `recordQuoteViewed` already applies to view tracking. */
export function recordQuoteEmailAttempt(
  db: DatabaseSync,
  businessId: string,
  id: string,
  status: "sent" | "failed",
  providerMessageId: string | undefined,
): void {
  db.prepare(
    `UPDATE quotes SET email_sent_at = ?, email_delivery_status = ?, email_provider_message_id = ?
     WHERE id = ? AND business_id = ?`,
  ).run(new Date().toISOString(), status, providerMessageId ?? null, id, businessId);
}
