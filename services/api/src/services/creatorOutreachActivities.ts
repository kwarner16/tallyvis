import { isCreatorOutreachStatus } from "@tallyvis/config";
import type { AuthSession } from "../auth/session";
import type { Queryable } from "../db/pg/client";
import { isAdminSession } from "./auth";
import * as activitiesRepo from "../repositories/creatorOutreachActivities";
import type { CreatorOutreachActivity } from "../repositories/creatorOutreachActivities";
import * as prospectsRepo from "../repositories/creatorProspects";
import type { CreatorProspect } from "../repositories/creatorProspects";

export type { CreatorOutreachActivity } from "../repositories/creatorOutreachActivities";

/** Founding Creator Outreach Tracker V1 — see docs/decisions/0042-creator-outreach-tracker.md. */

async function requireAdmin(db: Queryable, session: AuthSession): Promise<void> {
  if (!(await isAdminSession(db, session))) {
    throw new Error("Admin access required.");
  }
}

const NOTES_MAX_LENGTH = 4000;

export interface RecordCreatorOutreachActivityInput {
  status: string;
  notes?: string;
  followUpAt?: string;
}

/**
 * The one action behind "Save & Next Creator" — a single, immediate
 * write (see the migration's own comment on why outreach has no
 * start/end pairing the way a phone call does): records the activity
 * AND updates the prospect's own status/last-contacted/follow-up
 * snapshot together. `followUpAt` omitted clears any previously
 * scheduled follow-up — a later activity with no new follow-up
 * correctly supersedes a stale one, identical reasoning to the Sales
 * Call Tracker.
 */
export async function recordCreatorOutreachActivityAdmin(
  db: Queryable,
  session: AuthSession,
  prospectId: string,
  input: RecordCreatorOutreachActivityInput,
): Promise<CreatorProspect> {
  await requireAdmin(db, session);

  if (!isCreatorOutreachStatus(input.status)) {
    throw new Error(`Unknown outreach status "${input.status}".`);
  }
  if (input.followUpAt !== undefined && Number.isNaN(Date.parse(input.followUpAt))) {
    throw new Error("Please enter a valid follow-up date/time.");
  }

  const prospect = await prospectsRepo.getCreatorProspectById(db, prospectId);
  if (!prospect) throw new Error(`Creator prospect "${prospectId}" not found.`);

  const notes = (input.notes ?? "").trim().slice(0, NOTES_MAX_LENGTH);
  const now = new Date().toISOString();

  await activitiesRepo.createCreatorOutreachActivity(db, {
    prospectId,
    status: input.status,
    notes,
    followUpAt: input.followUpAt,
  });

  const updated = await prospectsRepo.applyCreatorProspectActivitySnapshot(db, prospectId, {
    status: input.status,
    lastContactedAt: now,
    followUpAt: input.followUpAt ?? null,
  });
  if (!updated) throw new Error(`Creator prospect "${prospectId}" not found.`);
  return updated;
}

export interface CreatorFollowUpDueEntry {
  prospect: CreatorProspect;
  lastActivity: CreatorOutreachActivity;
}

/** Follow-ups due now or overdue, soonest-due first — identical reasoning to the Sales Call Tracker's listFollowUpsDueAdmin. */
export async function listCreatorFollowUpsDueAdmin(db: Queryable, session: AuthSession): Promise<CreatorFollowUpDueEntry[]> {
  await requireAdmin(db, session);
  const now = new Date().toISOString();
  const dueRows = await activitiesRepo.listCreatorFollowUpsDue(db, now);

  const entries: CreatorFollowUpDueEntry[] = [];
  for (const row of dueRows) {
    const prospect = await prospectsRepo.getCreatorProspectById(db, row.activity.prospectId);
    if (prospect) entries.push({ prospect, lastActivity: row.activity });
  }
  return entries.sort((a, b) => (a.lastActivity.followUpAt ?? "").localeCompare(b.lastActivity.followUpAt ?? ""));
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export interface CreatorOutreachMetrics {
  totalProspects: number;
  contacted: number;
  awaitingReply: number;
  replied: number;
  interested: number;
  notInterested: number;
  followUpsDue: number;
  converted: number;
  /** replied ÷ contacted. `0` (never NaN) when nothing has been contacted yet. */
  outreachToReplyRate: number;
  /** interested ÷ contacted. `0` (never NaN) when nothing has been contacted yet. */
  outreachToInterestedRate: number;
  /** converted ÷ total prospects. `0` (never NaN) when there are no prospects. */
  outreachToConversionRate: number;
}

/**
 * Every number derived from `creator_prospects`'/`creator_outreach_activities`'
 * CURRENT snapshot state — see the ADR's "Metrics" section for exact
 * denominators. "Contacted" is every prospect whose status is anything
 * other than `not_contacted`; "replied" counts `replied`/`interested`/
 * `not_interested`/`follow_up`/`email2_sent`/`converted` (anything that
 * implies the creator actually responded).
 */
const REPLIED_STATUSES = new Set(["replied", "interested", "not_interested", "follow_up", "email2_sent", "converted"]);

export async function getCreatorOutreachMetricsAdmin(db: Queryable, session: AuthSession): Promise<CreatorOutreachMetrics> {
  await requireAdmin(db, session);

  const prospects = await prospectsRepo.listAllCreatorProspects(db);
  const followUpsDue = await listCreatorFollowUpsDueAdmin(db, session);

  const contacted = prospects.filter((p) => p.status !== "not_contacted").length;
  const replied = prospects.filter((p) => REPLIED_STATUSES.has(p.status)).length;
  const interested = prospects.filter((p) => p.status === "interested").length;
  const notInterested = prospects.filter((p) => p.status === "not_interested").length;
  const converted = prospects.filter((p) => p.status === "converted").length;
  const awaitingReply = prospects.filter((p) => p.status === "awaiting_reply" || p.status === "email1_sent" || p.status === "email2_sent").length;

  return {
    totalProspects: prospects.length,
    contacted,
    awaitingReply,
    replied,
    interested,
    notInterested,
    followUpsDue: followUpsDue.length,
    converted,
    outreachToReplyRate: contacted > 0 ? replied / contacted : 0,
    outreachToInterestedRate: contacted > 0 ? interested / contacted : 0,
    outreachToConversionRate: prospects.length > 0 ? converted / prospects.length : 0,
  };
}
