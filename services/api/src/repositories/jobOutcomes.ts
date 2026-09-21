import type { DatabaseSync } from "node:sqlite";
import type { AccessibilityLevel } from "@tallyvis/types";
import { makeId } from "../db/ids";

/**
 * Phase 13 — real-world job outcome & data collection foundation. See
 * docs/decisions/0015-job-outcome-tracking.md. One row per quote
 * (`quote_id` is unique — see 0003_job_outcomes.sql), recorded well after
 * the quote itself was priced and never mutating it.
 */

export type JobOutcomeStatus = "in_progress" | "completed";

export interface JobOutcome {
  id: string;
  quoteId: string;
  businessId: string;
  status: JobOutcomeStatus;
  actualStartedAt?: string;
  actualCompletedAt?: string;
  actualLaborMinutes?: number;
  actualWindowCount?: number;
  actualScreenCount?: number;
  actualStoryCount?: number;
  actualPrice?: number;
  actualDifficulty?: AccessibilityLevel;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

interface JobOutcomeRow {
  id: string;
  quote_id: string;
  business_id: string;
  status: string;
  actual_started_at: string | null;
  actual_completed_at: string | null;
  actual_labor_minutes: number | null;
  actual_window_count: number | null;
  actual_screen_count: number | null;
  actual_story_count: number | null;
  actual_price: number | null;
  actual_difficulty: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

function toOutcome(row: JobOutcomeRow): JobOutcome {
  return {
    id: row.id,
    quoteId: row.quote_id,
    businessId: row.business_id,
    status: row.status as JobOutcomeStatus,
    actualStartedAt: row.actual_started_at ?? undefined,
    actualCompletedAt: row.actual_completed_at ?? undefined,
    actualLaborMinutes: row.actual_labor_minutes ?? undefined,
    actualWindowCount: row.actual_window_count ?? undefined,
    actualScreenCount: row.actual_screen_count ?? undefined,
    actualStoryCount: row.actual_story_count ?? undefined,
    actualPrice: row.actual_price ?? undefined,
    actualDifficulty: (row.actual_difficulty as AccessibilityLevel | null) ?? undefined,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface SaveJobOutcomeInput {
  status: JobOutcomeStatus;
  actualStartedAt?: string;
  actualCompletedAt?: string;
  actualLaborMinutes?: number;
  actualWindowCount?: number;
  actualScreenCount?: number;
  actualStoryCount?: number;
  actualPrice?: number;
  actualDifficulty?: AccessibilityLevel;
  notes: string;
}

export function getJobOutcomeByQuoteId(
  db: DatabaseSync,
  businessId: string,
  quoteId: string,
): JobOutcome | undefined {
  const row = db
    .prepare(`SELECT * FROM job_outcomes WHERE quote_id = ? AND business_id = ?`)
    .get(quoteId, businessId) as JobOutcomeRow | undefined;
  return row ? toOutcome(row) : undefined;
}

export function listJobOutcomesForBusiness(db: DatabaseSync, businessId: string): JobOutcome[] {
  const rows = db.prepare(`SELECT * FROM job_outcomes WHERE business_id = ?`).all(businessId) as unknown as JobOutcomeRow[];
  return rows.map(toOutcome);
}

/**
 * Inserts a new outcome for this quote, or updates the existing one — a
 * business filling this out fills in what it knows now and comes back
 * later for the rest, so this is always a full replace of the editable
 * fields, never a partial patch that could leave stale data behind. Scoped
 * by `businessId` in the WHERE clause itself on the update path, exactly
 * like every other mutation in this package — a forged/foreign `quoteId`
 * can never update another business's row.
 */
export function saveJobOutcome(
  db: DatabaseSync,
  businessId: string,
  quoteId: string,
  input: SaveJobOutcomeInput,
): JobOutcome {
  const now = new Date().toISOString();
  const existing = getJobOutcomeByQuoteId(db, businessId, quoteId);

  if (existing) {
    db.prepare(
      `UPDATE job_outcomes SET
         status = ?, actual_started_at = ?, actual_completed_at = ?, actual_labor_minutes = ?,
         actual_window_count = ?, actual_screen_count = ?, actual_story_count = ?,
         actual_price = ?, actual_difficulty = ?, notes = ?, updated_at = ?
       WHERE quote_id = ? AND business_id = ?`,
    ).run(
      input.status,
      input.actualStartedAt ?? null,
      input.actualCompletedAt ?? null,
      input.actualLaborMinutes ?? null,
      input.actualWindowCount ?? null,
      input.actualScreenCount ?? null,
      input.actualStoryCount ?? null,
      input.actualPrice ?? null,
      input.actualDifficulty ?? null,
      input.notes,
      now,
      quoteId,
      businessId,
    );
  } else {
    db.prepare(
      `INSERT INTO job_outcomes (
         id, quote_id, business_id, status, actual_started_at, actual_completed_at, actual_labor_minutes,
         actual_window_count, actual_screen_count, actual_story_count, actual_price, actual_difficulty,
         notes, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      makeId("job-outcome"),
      quoteId,
      businessId,
      input.status,
      input.actualStartedAt ?? null,
      input.actualCompletedAt ?? null,
      input.actualLaborMinutes ?? null,
      input.actualWindowCount ?? null,
      input.actualScreenCount ?? null,
      input.actualStoryCount ?? null,
      input.actualPrice ?? null,
      input.actualDifficulty ?? null,
      input.notes,
      now,
      now,
    );
  }

  const saved = getJobOutcomeByQuoteId(db, businessId, quoteId);
  if (!saved) throw new Error("Failed to read back the job outcome that was just saved.");
  return saved;
}
