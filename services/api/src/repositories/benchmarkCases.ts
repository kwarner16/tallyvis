import type {
  AccessibilityLevel,
  BenchmarkCondition,
  ConfidenceLevel,
  Estimate,
  PropertyType,
  WindowCleaningCharacteristics,
} from "@tallyvis/types";
import type { EvidenceCoverage, EvidenceIssue, OverallEvidence, RawPropertyObservation } from "@tallyvis/ai";
import { makeId } from "../db/ids";
import type { Queryable } from "../db/pg/client";

/**
 * Final validation & launch-readiness phase (2026-09) — the internal
 * estimator benchmark harness's storage layer. See
 * services/api/src/services/benchmarkCases.ts for the full design
 * reasoning (in particular, why this deliberately never stores the
 * submitted photos themselves), and `@tallyvis/types`' own comment on
 * `BENCHMARK_CONDITIONS` for why that constant lives there instead of here.
 */
export type { BenchmarkCondition };

export interface BenchmarkGroundTruth {
  windowCount?: number;
  screenCount?: number;
  stories?: number;
  accessibility?: AccessibilityLevel;
}

export interface BenchmarkAiSummary {
  observation: RawPropertyObservation;
  windowCount?: number;
  windowStatus: string;
  screenCount?: number;
  screenStatus: string;
  stories?: number;
  storiesStatus: string;
  overallConfidence: ConfidenceLevel;
  evidenceCoverage: EvidenceCoverage;
  evidenceOverall: OverallEvidence;
  evidenceIssues: EvidenceIssue[];
  morePhotosRecommended: boolean;
  evidenceMessages: string[];
}

export interface BenchmarkConfirmedResult {
  characteristics: WindowCleaningCharacteristics;
  confidence: ConfidenceLevel;
  wouldNeedReview: boolean;
  estimate: Estimate;
}

export interface BenchmarkCase {
  id: string;
  businessId: string;
  testName?: string;
  address?: string;
  propertyType?: PropertyType;
  testedAt: string;
  notes: string;
  conditions: BenchmarkCondition[];
  photoCount: number;
  ai: BenchmarkAiSummary;
  confirmed: BenchmarkConfirmedResult;
  groundTruth: BenchmarkGroundTruth;
  previousCaseId?: string;
  createdAt: string;
}

export interface SaveBenchmarkCaseInput {
  testName?: string;
  address?: string;
  propertyType?: PropertyType;
  testedAt: string;
  notes: string;
  conditions: BenchmarkCondition[];
  photoCount: number;
  ai: BenchmarkAiSummary;
  confirmed: BenchmarkConfirmedResult;
  groundTruth: BenchmarkGroundTruth;
  previousCaseId?: string;
}

interface BenchmarkCaseRow {
  id: string;
  business_id: string;
  test_name: string | null;
  address: string | null;
  property_type: string | null;
  tested_at: string;
  notes: string;
  conditions_json: string;
  photo_count: number;
  raw_observation_json: string | null;
  ai_window_count: number | null;
  ai_window_status: string;
  ai_screen_count: number | null;
  ai_screen_status: string;
  ai_stories: number | null;
  ai_stories_status: string;
  ai_overall_confidence: string;
  evidence_coverage: string;
  evidence_overall: string;
  evidence_issues_json: string;
  more_photos_recommended: boolean;
  evidence_messages_json: string;
  confirmed_characteristics_json: string;
  confirmed_confidence: string;
  would_need_review: boolean;
  final_estimate_json: string;
  gt_window_count: number | null;
  gt_screen_count: number | null;
  gt_stories: number | null;
  gt_accessibility: string | null;
  previous_case_id: string | null;
  created_at: string;
}

function toBenchmarkCase(row: BenchmarkCaseRow): BenchmarkCase {
  return {
    id: row.id,
    businessId: row.business_id,
    testName: row.test_name ?? undefined,
    address: row.address ?? undefined,
    propertyType: (row.property_type as PropertyType | null) ?? undefined,
    testedAt: row.tested_at,
    notes: row.notes,
    conditions: JSON.parse(row.conditions_json) as BenchmarkCondition[],
    photoCount: row.photo_count,
    ai: {
      observation: JSON.parse(row.raw_observation_json!) as RawPropertyObservation,
      windowCount: row.ai_window_count ?? undefined,
      windowStatus: row.ai_window_status,
      screenCount: row.ai_screen_count ?? undefined,
      screenStatus: row.ai_screen_status,
      stories: row.ai_stories ?? undefined,
      storiesStatus: row.ai_stories_status,
      overallConfidence: row.ai_overall_confidence as ConfidenceLevel,
      evidenceCoverage: row.evidence_coverage as EvidenceCoverage,
      evidenceOverall: row.evidence_overall as OverallEvidence,
      evidenceIssues: JSON.parse(row.evidence_issues_json) as EvidenceIssue[],
      morePhotosRecommended: row.more_photos_recommended,
      evidenceMessages: JSON.parse(row.evidence_messages_json) as string[],
    },
    confirmed: {
      characteristics: JSON.parse(row.confirmed_characteristics_json) as WindowCleaningCharacteristics,
      confidence: row.confirmed_confidence as ConfidenceLevel,
      wouldNeedReview: row.would_need_review,
      estimate: JSON.parse(row.final_estimate_json) as Estimate,
    },
    groundTruth: {
      windowCount: row.gt_window_count ?? undefined,
      screenCount: row.gt_screen_count ?? undefined,
      stories: row.gt_stories ?? undefined,
      accessibility: (row.gt_accessibility as AccessibilityLevel | null) ?? undefined,
    },
    previousCaseId: row.previous_case_id ?? undefined,
    createdAt: row.created_at,
  };
}

export async function saveBenchmarkCase(
  db: Queryable,
  businessId: string,
  input: SaveBenchmarkCaseInput,
): Promise<BenchmarkCase> {
  const id = makeId("benchmark");
  const now = new Date().toISOString();

  await db.query(
    `INSERT INTO benchmark_cases (
       id, business_id, test_name, address, property_type, tested_at, notes, conditions_json, photo_count,
       raw_observation_json, ai_window_count, ai_window_status, ai_screen_count, ai_screen_status,
       ai_stories, ai_stories_status, ai_overall_confidence, evidence_coverage, evidence_overall,
       evidence_issues_json, more_photos_recommended, evidence_messages_json,
       confirmed_characteristics_json, confirmed_confidence, would_need_review, final_estimate_json,
       gt_window_count, gt_screen_count, gt_stories, gt_accessibility, previous_case_id, created_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21,
       $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32
     )`,
    [
      id,
      businessId,
      input.testName ?? null,
      input.address ?? null,
      input.propertyType ?? null,
      input.testedAt,
      input.notes,
      JSON.stringify(input.conditions),
      input.photoCount,
      JSON.stringify(input.ai.observation),
      input.ai.windowCount ?? null,
      input.ai.windowStatus,
      input.ai.screenCount ?? null,
      input.ai.screenStatus,
      input.ai.stories ?? null,
      input.ai.storiesStatus,
      input.ai.overallConfidence,
      input.ai.evidenceCoverage,
      input.ai.evidenceOverall,
      JSON.stringify(input.ai.evidenceIssues),
      input.ai.morePhotosRecommended,
      JSON.stringify(input.ai.evidenceMessages),
      JSON.stringify(input.confirmed.characteristics),
      input.confirmed.confidence,
      input.confirmed.wouldNeedReview,
      JSON.stringify(input.confirmed.estimate),
      input.groundTruth.windowCount ?? null,
      input.groundTruth.screenCount ?? null,
      input.groundTruth.stories ?? null,
      input.groundTruth.accessibility ?? null,
      input.previousCaseId ?? null,
      now,
    ],
  );

  const result = await db.query<BenchmarkCaseRow>(`SELECT * FROM benchmark_cases WHERE id = $1`, [id]);
  const row = result.rows[0];
  if (!row) throw new Error("Failed to read back the benchmark case that was just saved.");
  return toBenchmarkCase(row);
}

export async function listBenchmarkCases(db: Queryable, businessId: string): Promise<BenchmarkCase[]> {
  const result = await db.query<BenchmarkCaseRow>(
    `SELECT * FROM benchmark_cases WHERE business_id = $1 ORDER BY created_at DESC`,
    [businessId],
  );
  return result.rows.map(toBenchmarkCase);
}

export async function deleteBenchmarkCase(db: Queryable, businessId: string, id: string): Promise<boolean> {
  const result = await db.query(`DELETE FROM benchmark_cases WHERE id = $1 AND business_id = $2`, [id, businessId]);
  return (result.rowCount ?? 0) > 0;
}
