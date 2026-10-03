import { makeId } from "../db/ids";
import type { Queryable } from "../db/pg/client";

/**
 * Founding Creator Outreach Tracker V1 (internal admin tool — see
 * docs/decisions/0042-creator-outreach-tracker.md). A creator prospect
 * is never a `creators` row — see `converted_creator_id`'s own comment
 * in the migration for the one safe, explicit link between the two.
 */

export interface CreatorProspect {
  id: string;
  displayName: string;
  contactName?: string;
  contactEmail?: string;
  /** Lowercased/trimmed — the primary email-based duplicate-detection key. */
  normalizedEmail?: string;
  platform: string;
  profileUrl?: string;
  /** Canonical host+path — the primary URL-based duplicate-detection key. Only ever set from a profile_url that passed the http(s)-only safety check. */
  normalizedProfileUrl?: string;
  otherProfileUrls: string[];
  niche?: string;
  followersApprox?: number;
  notes: string;
  source?: string;
  status: string;
  lastContactedAt?: string;
  followUpAt?: string;
  convertedCreatorId?: string;
  createdAt: string;
  updatedAt: string;
}

interface CreatorProspectRow {
  id: string;
  display_name: string;
  contact_name: string | null;
  contact_email: string | null;
  normalized_email: string | null;
  platform: string;
  profile_url: string | null;
  normalized_profile_url: string | null;
  other_profile_urls_json: string;
  niche: string | null;
  followers_approx: number | null;
  notes: string;
  source: string | null;
  status: string;
  last_contacted_at: string | null;
  follow_up_at: string | null;
  converted_creator_id: string | null;
  created_at: string;
  updated_at: string;
}

function toCreatorProspect(row: CreatorProspectRow): CreatorProspect {
  return {
    id: row.id,
    displayName: row.display_name,
    contactName: row.contact_name ?? undefined,
    contactEmail: row.contact_email ?? undefined,
    normalizedEmail: row.normalized_email ?? undefined,
    platform: row.platform,
    profileUrl: row.profile_url ?? undefined,
    normalizedProfileUrl: row.normalized_profile_url ?? undefined,
    otherProfileUrls: JSON.parse(row.other_profile_urls_json) as string[],
    niche: row.niche ?? undefined,
    followersApprox: row.followers_approx ?? undefined,
    notes: row.notes,
    source: row.source ?? undefined,
    status: row.status,
    lastContactedAt: row.last_contacted_at ?? undefined,
    followUpAt: row.follow_up_at ?? undefined,
    convertedCreatorId: row.converted_creator_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateCreatorProspectInput {
  displayName: string;
  contactName?: string;
  contactEmail?: string;
  normalizedEmail?: string;
  platform?: string;
  profileUrl?: string;
  normalizedProfileUrl?: string;
  otherProfileUrls?: string[];
  niche?: string;
  followersApprox?: number;
  source?: string;
}

export async function createCreatorProspect(db: Queryable, input: CreateCreatorProspectInput): Promise<CreatorProspect> {
  const id = makeId("creatorprospect");
  const now = new Date().toISOString();
  await db.query(
    `INSERT INTO creator_prospects
       (id, display_name, contact_name, contact_email, normalized_email, platform, profile_url, normalized_profile_url,
        other_profile_urls_json, niche, followers_approx, source, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'not_contacted', $13, $13)`,
    [
      id,
      input.displayName,
      input.contactName ?? null,
      input.contactEmail ?? null,
      input.normalizedEmail ?? null,
      input.platform ?? "",
      input.profileUrl ?? null,
      input.normalizedProfileUrl ?? null,
      JSON.stringify(input.otherProfileUrls ?? []),
      input.niche ?? null,
      input.followersApprox ?? null,
      input.source ?? null,
      now,
    ],
  );
  const result = await db.query<CreatorProspectRow>(`SELECT * FROM creator_prospects WHERE id = $1`, [id]);
  return toCreatorProspect(result.rows[0]!);
}

export async function getCreatorProspectById(db: Queryable, id: string): Promise<CreatorProspect | undefined> {
  const result = await db.query<CreatorProspectRow>(`SELECT * FROM creator_prospects WHERE id = $1`, [id]);
  const row = result.rows[0];
  return row ? toCreatorProspect(row) : undefined;
}

/** The primary email-based duplicate signal. */
export async function findCreatorProspectsByNormalizedEmails(db: Queryable, emails: string[]): Promise<CreatorProspect[]> {
  if (emails.length === 0) return [];
  const result = await db.query<CreatorProspectRow>(`SELECT * FROM creator_prospects WHERE normalized_email = ANY($1::text[])`, [
    emails,
  ]);
  return result.rows.map(toCreatorProspect);
}

/** The primary canonical-URL-based duplicate signal. */
export async function findCreatorProspectsByNormalizedProfileUrls(db: Queryable, urls: string[]): Promise<CreatorProspect[]> {
  if (urls.length === 0) return [];
  const result = await db.query<CreatorProspectRow>(`SELECT * FROM creator_prospects WHERE normalized_profile_url = ANY($1::text[])`, [
    urls,
  ]);
  return result.rows.map(toCreatorProspect);
}

/** Case-insensitive exact display-name match — a "possible duplicate" signal only, never the primary key (see the ADR). */
export async function findCreatorProspectsByDisplayNames(db: Queryable, names: string[]): Promise<CreatorProspect[]> {
  if (names.length === 0) return [];
  const result = await db.query<CreatorProspectRow>(`SELECT * FROM creator_prospects WHERE lower(display_name) = ANY($1::text[])`, [
    names.map((n) => n.toLowerCase()),
  ]);
  return result.rows.map(toCreatorProspect);
}

export interface UpdateCreatorProspectInput {
  displayName?: string;
  contactName?: string | null;
  contactEmail?: string | null;
  normalizedEmail?: string | null;
  platform?: string;
  profileUrl?: string | null;
  normalizedProfileUrl?: string | null;
  otherProfileUrls?: string[];
  niche?: string | null;
  followersApprox?: number | null;
  notes?: string;
}

export async function updateCreatorProspect(db: Queryable, id: string, input: UpdateCreatorProspectInput): Promise<CreatorProspect | undefined> {
  const now = new Date().toISOString();
  const result = await db.query(
    `UPDATE creator_prospects SET
       display_name = COALESCE($1, display_name),
       contact_name = COALESCE($2, contact_name),
       contact_email = COALESCE($3, contact_email),
       normalized_email = COALESCE($4, normalized_email),
       platform = COALESCE($5, platform),
       profile_url = COALESCE($6, profile_url),
       normalized_profile_url = COALESCE($7, normalized_profile_url),
       other_profile_urls_json = COALESCE($8, other_profile_urls_json),
       niche = COALESCE($9, niche),
       followers_approx = COALESCE($10, followers_approx),
       notes = COALESCE($11, notes),
       updated_at = $12
     WHERE id = $13`,
    [
      input.displayName,
      input.contactName,
      input.contactEmail,
      input.normalizedEmail,
      input.platform,
      input.profileUrl,
      input.normalizedProfileUrl,
      input.otherProfileUrls !== undefined ? JSON.stringify(input.otherProfileUrls) : undefined,
      input.niche,
      input.followersApprox,
      input.notes,
      now,
      id,
    ],
  );
  if (result.rowCount === 0) return undefined;
  return getCreatorProspectById(db, id);
}

/** Stamps the status/last-contacted/follow-up snapshot — called once per recorded activity, alongside the append-only `creator_outreach_activities` row (see services/creatorOutreachActivities.ts). `followUpAt: null` explicitly clears a stale follow-up when a new activity doesn't set one. */
export async function applyCreatorProspectActivitySnapshot(
  db: Queryable,
  id: string,
  snapshot: { status: string; lastContactedAt: string; followUpAt: string | null },
): Promise<CreatorProspect | undefined> {
  const result = await db.query(
    `UPDATE creator_prospects SET status = $1, last_contacted_at = $2, follow_up_at = $3, updated_at = $2 WHERE id = $4`,
    [snapshot.status, snapshot.lastContactedAt, snapshot.followUpAt, id],
  );
  if (result.rowCount === 0) return undefined;
  return getCreatorProspectById(db, id);
}

/**
 * Sets `converted_creator_id` ONLY if it isn't already set — the
 * conditional `WHERE` clause is the real atomicity guarantee (paired
 * with the migration's own partial unique index on this column) that
 * prevents the same prospect being converted twice, even under a
 * concurrent double-submit. See
 * `services/creatorProspects.ts`'s `convertProspectToCreatorAdmin` for
 * how this is used inside a transaction together with
 * `createCreatorAdmin`.
 */
export async function markCreatorProspectConverted(db: Queryable, id: string, creatorId: string): Promise<CreatorProspect | undefined> {
  const now = new Date().toISOString();
  const result = await db.query(
    `UPDATE creator_prospects SET converted_creator_id = $1, status = 'converted', updated_at = $2
     WHERE id = $3 AND converted_creator_id IS NULL`,
    [creatorId, now, id],
  );
  if (result.rowCount === 0) return undefined;
  return getCreatorProspectById(db, id);
}

export interface CreatorOutreachQueueRow {
  prospect: CreatorProspect;
  lastActivityNotes?: string;
}

/**
 * Every prospect, enriched with its most recent activity's notes (for
 * quick context in the queue table) — the same "single round-trip SQL,
 * LEFT JOIN LATERAL" shape `repositories/salesProspects.ts`'s own queue
 * query already uses. Ordering is decided by the SERVICE layer
 * (`services/creatorProspects.ts`), not here.
 */
export async function listCreatorOutreachQueueRows(db: Queryable): Promise<CreatorOutreachQueueRow[]> {
  const result = await db.query<CreatorProspectRow & { last_activity_notes: string | null }>(
    `SELECT
       p.*,
       a.notes AS last_activity_notes
     FROM creator_prospects p
     LEFT JOIN LATERAL (
       SELECT notes
       FROM creator_outreach_activities
       WHERE prospect_id = p.id
       ORDER BY created_at DESC
       LIMIT 1
     ) a ON true
     ORDER BY p.created_at ASC`,
  );
  return result.rows.map((row) => ({
    prospect: toCreatorProspect(row),
    lastActivityNotes: row.last_activity_notes ?? undefined,
  }));
}

export async function listAllCreatorProspects(db: Queryable): Promise<CreatorProspect[]> {
  const result = await db.query<CreatorProspectRow>(`SELECT * FROM creator_prospects`);
  return result.rows.map(toCreatorProspect);
}
