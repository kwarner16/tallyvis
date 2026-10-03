import { isSalesCallOutcome, isSalesObjection, isConnectedSalesCallOutcome, type SalesCallOutcome } from "@tallyvis/config";
import type { AuthSession } from "../auth/session";
import type { Queryable } from "../db/pg/client";
import { isAdminSession } from "./auth";
import * as callsRepo from "../repositories/salesCalls";
import type { SalesCall } from "../repositories/salesCalls";
import * as prospectsRepo from "../repositories/salesProspects";
import type { SalesProspect } from "../repositories/salesProspects";

export type { SalesCall } from "../repositories/salesCalls";

/**
 * Sales Call Tracker V1 — call lifecycle, follow-ups, and metrics (see
 * docs/decisions/0041-sales-call-tracker.md). Internal admin-only; every
 * exported function independently re-checks admin access.
 */

async function requireAdmin(db: Queryable, session: AuthSession): Promise<void> {
  if (!(await isAdminSession(db, session))) {
    throw new Error("Admin access required.");
  }
}

const NOTES_MAX_LENGTH = 4000;

// ---------------------------------------------------------------------------
// Call lifecycle
// ---------------------------------------------------------------------------

/**
 * Starts a call, OR — if this admin already has one in progress (e.g. a
 * page refresh/back-button, or a stray second tab) — returns that SAME
 * active call instead of erroring or silently creating a second one.
 * The database's own partial unique index
 * (`idx_sales_calls_one_active_per_user`) is the real guarantee; this
 * check is what turns a race into a graceful "you're already on this
 * call" rather than a raw constraint-violation error reaching the UI.
 */
export async function startSalesCallAdmin(db: Queryable, session: AuthSession, prospectId: string): Promise<SalesCall> {
  await requireAdmin(db, session);

  const existingActive = await callsRepo.getActiveSalesCallForUser(db, session.userId);
  if (existingActive) return existingActive;

  const prospect = await prospectsRepo.getSalesProspectById(db, prospectId);
  if (!prospect) throw new Error(`Prospect "${prospectId}" not found.`);

  return callsRepo.createSalesCall(db, prospectId, session.userId);
}

export async function getActiveSalesCallAdmin(db: Queryable, session: AuthSession): Promise<SalesCall | undefined> {
  await requireAdmin(db, session);
  return callsRepo.getActiveSalesCallForUser(db, session.userId);
}

export interface SalesCallDetail {
  call: SalesCall;
  prospect: SalesProspect;
  /** Prior call history for this same prospect, most recent first — "previous call history/notes if this is a follow-up" (brief's own requirement for the in-call screen). Never includes the active call itself. */
  priorCalls: SalesCall[];
}

export async function getSalesCallDetailAdmin(db: Queryable, session: AuthSession, callId: string): Promise<SalesCallDetail | undefined> {
  await requireAdmin(db, session);
  const call = await callsRepo.getSalesCallById(db, callId);
  if (!call) return undefined;
  const prospect = await prospectsRepo.getSalesProspectById(db, call.prospectId);
  if (!prospect) return undefined;
  const allCalls = await callsRepo.listSalesCallsByProspectId(db, call.prospectId);
  const priorCalls = allCalls.filter((c) => c.id !== call.id);
  return { call, prospect, priorCalls };
}

export interface EndSalesCallAdminInput {
  outcome: string;
  notes?: string;
  objections?: string[];
  followUpAt?: string;
}

/** The one action behind "Save & Next Call" — validates, then persists outcome/notes/objections/follow-up and `ended_at`/duration together in one write (see repositories/salesCalls.ts's own comment on why there is no separate "ended but no outcome" state). */
export async function endSalesCallAdmin(db: Queryable, session: AuthSession, callId: string, input: EndSalesCallAdminInput): Promise<SalesCall> {
  await requireAdmin(db, session);

  if (!isSalesCallOutcome(input.outcome)) {
    throw new Error(`Unknown call outcome "${input.outcome}".`);
  }
  const objections = (input.objections ?? []).filter((objection, index, all) => all.indexOf(objection) === index);
  for (const objection of objections) {
    if (!isSalesObjection(objection)) throw new Error(`Unknown objection "${objection}".`);
  }
  if (input.followUpAt !== undefined && Number.isNaN(Date.parse(input.followUpAt))) {
    throw new Error("Please enter a valid follow-up date/time.");
  }

  const updated = await callsRepo.endSalesCall(db, callId, {
    outcome: input.outcome,
    notes: (input.notes ?? "").trim().slice(0, NOTES_MAX_LENGTH),
    objections,
    followUpAt: input.followUpAt,
  });
  if (!updated) throw new Error("This call was not found, or has already ended.");
  return updated;
}

// ---------------------------------------------------------------------------
// Follow-ups
// ---------------------------------------------------------------------------

export interface FollowUpDueEntry {
  prospect: SalesProspect;
  lastCall: SalesCall;
}

/** Follow-ups due now or overdue, soonest-due first — the brief's own "Follow-up queue" section. Each prospect appears at most once, driven by its MOST RECENT completed call only (see repositories/salesCalls.ts's `listFollowUpsDue`). */
export async function listFollowUpsDueAdmin(db: Queryable, session: AuthSession): Promise<FollowUpDueEntry[]> {
  await requireAdmin(db, session);
  const now = new Date().toISOString();
  const dueRows = await callsRepo.listFollowUpsDue(db, now);

  const entries: FollowUpDueEntry[] = [];
  for (const row of dueRows) {
    const prospect = await prospectsRepo.getSalesProspectById(db, row.call.prospectId);
    if (prospect) entries.push({ prospect, lastCall: row.call });
  }
  return entries.sort((a, b) => (a.lastCall.followUpAt ?? "").localeCompare(b.lastCall.followUpAt ?? ""));
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export type SalesMetricsPeriod = "today" | "7d" | "30d" | "all";

export interface SalesMetrics {
  totalCalls: number;
  callsToday: number;
  answeredCount: number;
  noAnswerCount: number;
  voicemailCount: number;
  interestedCount: number;
  demoCount: number;
  followUpCount: number;
  signedUpCount: number;
  /** signups / total calls in the selected period. `0` when there are no calls, never `NaN`/`Infinity`. */
  callToSignupRate: number;
  /** signups / answered(connected) calls in the selected period — `undefined` when there are zero connected calls (nothing to safely divide by). */
  conversationToSignupRate?: number;
  /** Seconds, across every completed call in the period that has a duration — `undefined` when there are none. */
  averageCallDurationSeconds?: number;
}

function startOfTodayUtc(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

function periodStartIso(period: SalesMetricsPeriod, now: Date): string | undefined {
  switch (period) {
    case "today":
      return startOfTodayUtc(now);
    case "7d":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    case "30d":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    case "all":
      return undefined;
  }
}

/**
 * Every number here is derived straight from completed `sales_calls` rows
 * — see the ADR's "Metrics" section for each definition. Deliberately
 * does NOT touch `businesses`/`subscriptions`: a "Signed Up" outcome is a
 * sales-call label, never a fabricated link to a real paying customer
 * (brief's own explicit constraint — "signed up ≠ paid customer").
 */
export async function getSalesMetricsAdmin(db: Queryable, session: AuthSession, period: SalesMetricsPeriod = "all"): Promise<SalesMetrics> {
  await requireAdmin(db, session);

  const now = new Date();
  const periodStart = periodStartIso(period, now);
  const allCompleted = await callsRepo.listCompletedSalesCalls(db);
  const inPeriod = periodStart ? allCompleted.filter((call) => call.startedAt >= periodStart) : allCompleted;

  const todayStart = startOfTodayUtc(now);
  const callsToday = allCompleted.filter((call) => call.startedAt >= todayStart).length;

  const countByOutcome = (outcome: SalesCallOutcome) => inPeriod.filter((call) => call.outcome === outcome).length;
  const answeredCount = inPeriod.filter((call) => call.outcome && isConnectedSalesCallOutcome(call.outcome)).length;
  const signedUpCount = countByOutcome("signed_up");

  const durations = inPeriod.map((call) => call.durationSeconds).filter((d): d is number => typeof d === "number");
  const averageCallDurationSeconds =
    durations.length > 0 ? Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length) : undefined;

  return {
    totalCalls: inPeriod.length,
    callsToday,
    answeredCount,
    noAnswerCount: countByOutcome("no_answer"),
    voicemailCount: countByOutcome("voicemail"),
    interestedCount: countByOutcome("interested"),
    demoCount: countByOutcome("demo_requested"),
    followUpCount: countByOutcome("follow_up"),
    signedUpCount,
    callToSignupRate: inPeriod.length > 0 ? signedUpCount / inPeriod.length : 0,
    conversationToSignupRate: answeredCount > 0 ? signedUpCount / answeredCount : undefined,
    averageCallDurationSeconds,
  };
}

export interface TodaySalesSummary {
  callsToday: number;
  answeredToday: number;
  interestedToday: number;
  signedUpToday: number;
  followUpsDueCount: number;
}

/** The brief's own "simple Today summary" at the top of `/admin/sales` — `followUpsDueCount` is forward-looking (due now/overdue), not scoped to today's calls, matching section 8's separate framing. */
export async function getTodaySalesSummaryAdmin(db: Queryable, session: AuthSession): Promise<TodaySalesSummary> {
  await requireAdmin(db, session);

  const now = new Date();
  const todayStart = startOfTodayUtc(now);
  const allCompleted = await callsRepo.listCompletedSalesCalls(db);
  const today = allCompleted.filter((call) => call.startedAt >= todayStart);

  const followUpsDue = await listFollowUpsDueAdmin(db, session);

  return {
    callsToday: today.length,
    answeredToday: today.filter((call) => call.outcome && isConnectedSalesCallOutcome(call.outcome)).length,
    interestedToday: today.filter((call) => call.outcome === "interested").length,
    signedUpToday: today.filter((call) => call.outcome === "signed_up").length,
    followUpsDueCount: followUpsDue.length,
  };
}
