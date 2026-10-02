import { makeId } from "../db/ids";
import type { Queryable } from "../db/pg/client";

/**
 * TallyVis Founding Creator Program (see
 * docs/decisions/0040-creator-affiliate-program.md). One row per creator
 * — see db/pg/migrations/0015_creator_program.sql for the full schema
 * reasoning.
 */
export type CreatorStatus = "prospect" | "invited" | "active" | "paused" | "inactive";

export interface Creator {
  id: string;
  slug: string;
  name: string;
  email: string;
  platform: string;
  profileUrl: string;
  status: CreatorStatus;
  commissionRateBps: number;
  commissionDurationMonths: number;
  notes: string;
  businessId?: string;
  complimentaryAccess: boolean;
  clickCount: number;
  /** Stamped exactly once, the first time this creator's status becomes `"active"` — never moved again, even across a later pause/reactivate cycle. See `services/creators.ts`'s `firstActivityMonthStart`. */
  activatedAt?: string;
  lastQualifyingContentAt?: string;
  lastQualifyingContentUrl?: string;
  lastQualifyingContentNote?: string;
  createdAt: string;
  updatedAt: string;
}

interface CreatorRow {
  id: string;
  slug: string;
  name: string;
  email: string;
  platform: string;
  profile_url: string;
  status: string;
  commission_rate_bps: number;
  commission_duration_months: number;
  notes: string;
  business_id: string | null;
  complimentary_access: boolean;
  click_count: number;
  activated_at: string | null;
  last_qualifying_content_at: string | null;
  last_qualifying_content_url: string | null;
  last_qualifying_content_note: string | null;
  created_at: string;
  updated_at: string;
}

function toCreator(row: CreatorRow): Creator {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    email: row.email,
    platform: row.platform,
    profileUrl: row.profile_url,
    status: row.status as CreatorStatus,
    commissionRateBps: row.commission_rate_bps,
    commissionDurationMonths: row.commission_duration_months,
    notes: row.notes,
    businessId: row.business_id ?? undefined,
    complimentaryAccess: row.complimentary_access,
    clickCount: row.click_count,
    activatedAt: row.activated_at ?? undefined,
    lastQualifyingContentAt: row.last_qualifying_content_at ?? undefined,
    lastQualifyingContentUrl: row.last_qualifying_content_url ?? undefined,
    lastQualifyingContentNote: row.last_qualifying_content_note ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateCreatorInput {
  slug: string;
  name: string;
  email: string;
  platform: string;
  profileUrl: string;
  status: CreatorStatus;
  commissionRateBps: number;
  commissionDurationMonths: number;
  notes: string;
}

export async function createCreator(db: Queryable, input: CreateCreatorInput): Promise<Creator> {
  const id = makeId("creator");
  const now = new Date().toISOString();
  await db.query(
    `INSERT INTO creators (
       id, slug, name, email, platform, profile_url, status,
       commission_rate_bps, commission_duration_months, notes, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
    [
      id,
      input.slug,
      input.name,
      input.email,
      input.platform,
      input.profileUrl,
      input.status,
      input.commissionRateBps,
      input.commissionDurationMonths,
      input.notes,
      now,
    ],
  );
  const created = await getCreatorById(db, id);
  if (!created) throw new Error("Failed to read back the creator that was just created.");
  return created;
}

export async function getCreatorById(db: Queryable, id: string): Promise<Creator | undefined> {
  const result = await db.query<CreatorRow>(`SELECT * FROM creators WHERE id = $1`, [id]);
  const row = result.rows[0];
  return row ? toCreator(row) : undefined;
}

/** Case-insensitive, matching how `services/creators.ts` normalizes a slug before ever storing or looking one up — see that file's `normalizeSlug`. */
export async function getCreatorBySlug(db: Queryable, slug: string): Promise<Creator | undefined> {
  const result = await db.query<CreatorRow>(`SELECT * FROM creators WHERE slug = $1`, [slug]);
  const row = result.rows[0];
  return row ? toCreator(row) : undefined;
}

export async function getCreatorByBusinessId(db: Queryable, businessId: string): Promise<Creator | undefined> {
  const result = await db.query<CreatorRow>(`SELECT * FROM creators WHERE business_id = $1`, [businessId]);
  const row = result.rows[0];
  return row ? toCreator(row) : undefined;
}

export async function listCreators(db: Queryable): Promise<Creator[]> {
  const result = await db.query<CreatorRow>(`SELECT * FROM creators ORDER BY created_at DESC`);
  return result.rows.map(toCreator);
}

/**
 * Partial-patch update — every field omitted (left `undefined`) keeps its
 * existing stored value via `COALESCE`, the same convention
 * `repositories/subscriptions.ts`'s `upsertSubscription` already
 * established. `businessId`/`complimentaryAccess` use the same
 * COALESCE-preserve semantics; clearing a linked business back to `NULL`
 * is intentionally a separate, explicit operation
 * (`clearCreatorBusinessLink` below) rather than overloaded onto this
 * function, so "no change requested" and "explicitly unlink" can never be
 * confused.
 */
export interface UpdateCreatorInput {
  name?: string;
  email?: string;
  platform?: string;
  profileUrl?: string;
  status?: CreatorStatus;
  commissionRateBps?: number;
  commissionDurationMonths?: number;
  notes?: string;
  businessId?: string;
  complimentaryAccess?: boolean;
  /** COALESCE-preserve, like every other field here — but callers (see `services/creators.ts`'s `updateCreatorAdmin`) only ever pass this ONCE, the first time status transitions to `"active"`; never passed again afterward, so the column is never actually overwritten in practice even though this function alone doesn't enforce that. */
  activatedAt?: string;
}

export async function updateCreator(db: Queryable, id: string, input: UpdateCreatorInput): Promise<Creator | undefined> {
  const now = new Date().toISOString();
  const result = await db.query(
    `UPDATE creators SET
       name = COALESCE($1, name),
       email = COALESCE($2, email),
       platform = COALESCE($3, platform),
       profile_url = COALESCE($4, profile_url),
       status = COALESCE($5, status),
       commission_rate_bps = COALESCE($6, commission_rate_bps),
       commission_duration_months = COALESCE($7, commission_duration_months),
       notes = COALESCE($8, notes),
       business_id = COALESCE($9, business_id),
       complimentary_access = COALESCE($10, complimentary_access),
       activated_at = COALESCE(activated_at, $11),
       updated_at = $12
     WHERE id = $13`,
    [
      input.name,
      input.email,
      input.platform,
      input.profileUrl,
      input.status,
      input.commissionRateBps,
      input.commissionDurationMonths,
      input.notes,
      input.businessId,
      input.complimentaryAccess,
      input.activatedAt,
      now,
      id,
    ],
  );
  if (result.rowCount === 0) return undefined;
  return getCreatorById(db, id);
}

/** Manual, admin-entered activity record (see docs/decisions/0040's V1.1 addendum "Active Creator" section) — TallyVis does not, and does not claim to, automatically verify content publication. Each call REPLACES the previous "last qualifying content" entry; there is no history of every past entry, the same single-slot pattern `recordQuoteChangeRequest` already uses elsewhere in this codebase. */
export interface RecordCreatorActivityInput {
  contentAt: string;
  contentUrl: string;
  note: string;
}

export async function recordCreatorActivity(db: Queryable, id: string, input: RecordCreatorActivityInput): Promise<Creator | undefined> {
  const now = new Date().toISOString();
  const result = await db.query(
    `UPDATE creators SET
       last_qualifying_content_at = $1,
       last_qualifying_content_url = $2,
       last_qualifying_content_note = $3,
       updated_at = $4
     WHERE id = $5`,
    [input.contentAt, input.contentUrl, input.note, now, id],
  );
  if (result.rowCount === 0) return undefined;
  return getCreatorById(db, id);
}

/** The one explicit way to remove a creator's linked TallyVis business (see `UpdateCreatorInput`'s own comment for why this isn't folded into `updateCreator`). Also forces `complimentaryAccess` off — a complimentary grant with no linked business to apply it to is meaningless and must never be left dangling. */
export async function clearCreatorBusinessLink(db: Queryable, id: string): Promise<Creator | undefined> {
  const now = new Date().toISOString();
  const result = await db.query(
    `UPDATE creators SET business_id = NULL, complimentary_access = FALSE, updated_at = $1 WHERE id = $2`,
    [now, id],
  );
  if (result.rowCount === 0) return undefined;
  return getCreatorById(db, id);
}

/** Atomic increment — see the migration's own comment for why this is a plain counter, not a per-click event table. Safe under concurrency: a single `UPDATE ... SET x = x + 1` statement, never read-then-write from application code. */
export async function incrementCreatorClickCount(db: Queryable, id: string): Promise<void> {
  await db.query(`UPDATE creators SET click_count = click_count + 1 WHERE id = $1`, [id]);
}
