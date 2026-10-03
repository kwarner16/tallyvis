import { makeId } from "../db/ids";
import type { Queryable } from "../db/pg/client";

/** Founding Creator Outreach Tracker V1 — see docs/decisions/0042-creator-outreach-tracker.md. */

export interface CreatorOutreachActivity {
  id: string;
  prospectId: string;
  status: string;
  notes: string;
  followUpAt?: string;
  createdAt: string;
}

interface CreatorOutreachActivityRow {
  id: string;
  prospect_id: string;
  status: string;
  notes: string;
  follow_up_at: string | null;
  created_at: string;
}

function toActivity(row: CreatorOutreachActivityRow): CreatorOutreachActivity {
  return {
    id: row.id,
    prospectId: row.prospect_id,
    status: row.status,
    notes: row.notes,
    followUpAt: row.follow_up_at ?? undefined,
    createdAt: row.created_at,
  };
}

export interface CreateCreatorOutreachActivityInput {
  prospectId: string;
  status: string;
  notes: string;
  followUpAt?: string;
}

/** Always a single, immediate write — there is no "in progress" email to start/end (see the migration's own comment). */
export async function createCreatorOutreachActivity(db: Queryable, input: CreateCreatorOutreachActivityInput): Promise<CreatorOutreachActivity> {
  const id = makeId("outreachactivity");
  const now = new Date().toISOString();
  await db.query(
    `INSERT INTO creator_outreach_activities (id, prospect_id, status, notes, follow_up_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, input.prospectId, input.status, input.notes, input.followUpAt ?? null, now],
  );
  const result = await db.query<CreatorOutreachActivityRow>(`SELECT * FROM creator_outreach_activities WHERE id = $1`, [id]);
  return toActivity(result.rows[0]!);
}

export async function listCreatorOutreachActivitiesByProspectId(db: Queryable, prospectId: string): Promise<CreatorOutreachActivity[]> {
  const result = await db.query<CreatorOutreachActivityRow>(
    `SELECT * FROM creator_outreach_activities WHERE prospect_id = $1 ORDER BY created_at DESC`,
    [prospectId],
  );
  return result.rows.map(toActivity);
}

/** Every activity, flat — services/creatorOutreachActivities.ts's getCreatorOutreachMetricsAdmin aggregates this in TypeScript, the same "fetch flat rows, aggregate in JS" pattern used throughout this codebase. */
export async function listAllCreatorOutreachActivities(db: Queryable): Promise<CreatorOutreachActivity[]> {
  const result = await db.query<CreatorOutreachActivityRow>(`SELECT * FROM creator_outreach_activities ORDER BY created_at DESC`);
  return result.rows.map(toActivity);
}

export interface CreatorFollowUpDueRow {
  activity: CreatorOutreachActivity;
  prospectDisplayName: string;
}

/** Only a prospect's MOST RECENT activity counts toward a due follow-up — identical reasoning to the Sales Call Tracker's listFollowUpsDue. */
export async function listCreatorFollowUpsDue(db: Queryable, dueBy: string): Promise<CreatorFollowUpDueRow[]> {
  const result = await db.query<CreatorOutreachActivityRow & { display_name: string }>(
    `SELECT DISTINCT ON (a.prospect_id) a.*, p.display_name
     FROM creator_outreach_activities a
     JOIN creator_prospects p ON p.id = a.prospect_id
     ORDER BY a.prospect_id, a.created_at DESC`,
  );
  return result.rows
    .filter((row) => row.follow_up_at !== null && row.follow_up_at <= dueBy)
    .map((row) => ({ activity: toActivity(row), prospectDisplayName: row.display_name }));
}
