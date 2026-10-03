import { makeId } from "../db/ids";
import type { Queryable } from "../db/pg/client";

/** Sales Call Tracker V1 — see docs/decisions/0041-sales-call-tracker.md. */

export interface SalesCall {
  id: string;
  prospectId: string;
  startedByUserId: string;
  startedAt: string;
  endedAt?: string;
  durationSeconds?: number;
  outcome?: string;
  notes: string;
  /** Parsed from `objections_json` — see the migration's own comment on this column's convention. */
  objections: string[];
  followUpAt?: string;
  createdAt: string;
}

interface SalesCallRow {
  id: string;
  prospect_id: string;
  started_by_user_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  outcome: string | null;
  notes: string;
  objections_json: string;
  follow_up_at: string | null;
  created_at: string;
}

function toSalesCall(row: SalesCallRow): SalesCall {
  return {
    id: row.id,
    prospectId: row.prospect_id,
    startedByUserId: row.started_by_user_id,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
    durationSeconds: row.duration_seconds ?? undefined,
    outcome: row.outcome ?? undefined,
    notes: row.notes,
    objections: JSON.parse(row.objections_json) as string[],
    followUpAt: row.follow_up_at ?? undefined,
    createdAt: row.created_at,
  };
}

/** Stamps `started_at` server-side — see the migration's own comment on why this, not browser time, is the timer's source of truth. The `idx_sales_calls_one_active_per_user` partial unique index is the real guarantee against two simultaneous active calls; a violation here surfaces as a Postgres unique-violation error (see `isUniqueViolation`), which `services/salesCalls.ts`'s `startSalesCallAdmin` checks for defensively even though it already checks first. */
export async function createSalesCall(db: Queryable, prospectId: string, startedByUserId: string): Promise<SalesCall> {
  const id = makeId("salescall");
  const now = new Date().toISOString();
  await db.query(
    `INSERT INTO sales_calls (id, prospect_id, started_by_user_id, started_at, notes, objections_json, created_at)
     VALUES ($1, $2, $3, $4, '', '[]', $4)`,
    [id, prospectId, startedByUserId, now],
  );
  const result = await db.query<SalesCallRow>(`SELECT * FROM sales_calls WHERE id = $1`, [id]);
  return toSalesCall(result.rows[0]!);
}

export async function getSalesCallById(db: Queryable, id: string): Promise<SalesCall | undefined> {
  const result = await db.query<SalesCallRow>(`SELECT * FROM sales_calls WHERE id = $1`, [id]);
  const row = result.rows[0];
  return row ? toSalesCall(row) : undefined;
}

/** At most one row can ever match (the partial unique index) — the admin's current in-progress call, if any. */
export async function getActiveSalesCallForUser(db: Queryable, userId: string): Promise<SalesCall | undefined> {
  const result = await db.query<SalesCallRow>(
    `SELECT * FROM sales_calls WHERE started_by_user_id = $1 AND ended_at IS NULL LIMIT 1`,
    [userId],
  );
  const row = result.rows[0];
  return row ? toSalesCall(row) : undefined;
}

export interface EndSalesCallInput {
  outcome: string;
  notes: string;
  objections: string[];
  followUpAt?: string;
}

/** The only place `ended_at`/`duration_seconds`/outcome/notes/objections/follow-up are ever set — all together, in one write. See the migration's own comment: there is no separate "ended but no outcome yet" state. */
export async function endSalesCall(db: Queryable, id: string, input: EndSalesCallInput): Promise<SalesCall | undefined> {
  const call = await getSalesCallById(db, id);
  if (!call || call.endedAt) return undefined;

  const endedAt = new Date().toISOString();
  const durationSeconds = Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(call.startedAt)) / 1000));

  await db.query(
    `UPDATE sales_calls SET
       ended_at = $1,
       duration_seconds = $2,
       outcome = $3,
       notes = $4,
       objections_json = $5,
       follow_up_at = $6
     WHERE id = $7`,
    [endedAt, durationSeconds, input.outcome, input.notes, JSON.stringify(input.objections), input.followUpAt ?? null, id],
  );
  return getSalesCallById(db, id);
}

export async function listSalesCallsByProspectId(db: Queryable, prospectId: string): Promise<SalesCall[]> {
  const result = await db.query<SalesCallRow>(
    `SELECT * FROM sales_calls WHERE prospect_id = $1 ORDER BY started_at DESC`,
    [prospectId],
  );
  return result.rows.map(toSalesCall);
}

/** Every COMPLETED call, flat — `services/salesCalls.ts`'s `getSalesMetricsAdmin` aggregates this in TypeScript (this repo's established "fetch flat rows, aggregate in JS" pattern — see repositories/admin.ts), rather than a bespoke SQL aggregate per metric. */
export async function listCompletedSalesCalls(db: Queryable): Promise<SalesCall[]> {
  const result = await db.query<SalesCallRow>(`SELECT * FROM sales_calls WHERE ended_at IS NOT NULL ORDER BY started_at DESC`);
  return result.rows.map(toSalesCall);
}

export interface FollowUpDueRow {
  call: SalesCall;
  prospectBusinessName: string;
}

interface FollowUpDueRowDb extends SalesCallRow {
  business_name: string;
}

/**
 * For each prospect, only its MOST RECENT completed call counts toward a
 * due follow-up — an older call's `follow_up_at` is superseded the
 * moment a newer call happens, even if that newer call didn't itself set
 * a follow-up (e.g. a second "No Answer" after an "Interested" call
 * should stop surfacing the stale follow-up). `DISTINCT ON` picks exactly
 * that latest row per prospect in one query.
 */
export async function listFollowUpsDue(db: Queryable, dueBy: string): Promise<FollowUpDueRow[]> {
  const result = await db.query<FollowUpDueRowDb>(
    `SELECT DISTINCT ON (c.prospect_id) c.*, p.business_name
     FROM sales_calls c
     JOIN sales_prospects p ON p.id = c.prospect_id
     WHERE c.ended_at IS NOT NULL
     ORDER BY c.prospect_id, c.started_at DESC`,
  );
  return result.rows
    .filter((row) => row.follow_up_at !== null && row.follow_up_at <= dueBy)
    .map((row) => ({ call: toSalesCall(row), prospectBusinessName: row.business_name }));
}
