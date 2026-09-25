import type { AccessibilityLevel, ConfidenceLevel, PropertyType, WindowCleaningCharacteristics } from "@tallyvis/types";
import { calculateEstimate, reconcilePricingInput } from "@tallyvis/pricing";
import type { OverallEvidence, RawPropertyObservation } from "@tallyvis/ai";
import { describeEvidenceGaps } from "@tallyvis/ai";
import type { AuthSession } from "../auth/session";
import type { Queryable } from "../db/pg/client";
import * as benchmarkRepo from "../repositories/benchmarkCases";
import type { BenchmarkCase, BenchmarkCondition, BenchmarkGroundTruth } from "../repositories/benchmarkCases";
import { determineInitialQuoteStatus } from "./quotes";
import * as pricingService from "./pricing";

export {
  type BenchmarkCondition,
  type BenchmarkCase,
  type BenchmarkGroundTruth,
  type BenchmarkAiSummary,
  type BenchmarkConfirmedResult,
} from "../repositories/benchmarkCases";

/**
 * Final validation & launch-readiness phase (2026-09) — the internal
 * estimator benchmark harness (`/dashboard/testing`). Runs the exact same
 * `analyzePropertyForBusiness` pipeline the real product uses (called by
 * the same `analyzePropertyAction` the "New quote" dashboard flow already
 * calls — see apps/app/src/lib/quoteActions.ts) — this module never talks
 * to an AI provider itself, only ever consumes an already-completed
 * `AnalyzePropertyResult`. That keeps "AI does not invent the price" and
 * "no second AI implementation" both intact: this is purely a harness
 * around the same pipeline, pricing engine, and escalation policy
 * (`determineInitialQuoteStatus`) every real quote already goes through.
 *
 * Photo handling: the caller (the dashboard client component) compresses
 * photos with the same `imageCompression.ts` pipeline the estimator uses
 * and sends them through the SAME analysis action — but this module never
 * receives or persists the photo bytes themselves, only `photoCount`. A
 * benchmark case is internal engineering data about how well the AI did,
 * not a customer record, so there is no reason to grow a second permanent
 * photo store for it — see `repositories/benchmarkCases.ts`'s migration
 * comment for the same reasoning.
 */

export interface SaveBenchmarkCaseInput {
  testName?: string;
  address?: string;
  propertyType?: PropertyType;
  testedAt: string;
  notes: string;
  conditions: BenchmarkCondition[];
  photoCount: number;
  /** The AI's own analysis result, exactly as `analyzePropertyForBusiness` returned it — never re-derived or re-run here. */
  observation: RawPropertyObservation;
  reconciledCharacteristics: WindowCleaningCharacteristics;
  /** What the tester entered as the simulated customer confirmation/correction — pre-filled from `reconciledCharacteristics` in the UI, but never assumed to equal it. */
  confirmedCharacteristics: WindowCleaningCharacteristics;
  /**
   * Whether the tester marked any confirmed field "not sure" — mirrors
   * `/estimate/confirm`'s own `anyUnsure` flag, since this harness exists
   * to reproduce the real customer flow's escalation decision, not a
   * separate one.
   */
  anyUnsure: boolean;
  groundTruth: BenchmarkGroundTruth;
  previousCaseId?: string;
}

/**
 * Mirrors `/estimate/confirm`'s own confidence rule exactly (see
 * apps/app/src/app/estimate/confirm/page.tsx's `handleContinue`) — the
 * whole point of this harness is to measure what the REAL customer flow
 * would do, not a hypothetical stricter or looser one.
 */
function confirmedConfidence(observation: RawPropertyObservation, anyUnsure: boolean): ConfidenceLevel {
  const evidenceInsufficient = observation.evidence.overallEvidence === "insufficient";
  return anyUnsure || evidenceInsufficient ? "medium" : "high";
}

function observedNumber(field: RawPropertyObservation["windowCount"]): number | undefined {
  return field.status === "observed" ? field.value : undefined;
}

export async function saveBenchmarkCase(
  db: Queryable,
  session: AuthSession,
  input: SaveBenchmarkCaseInput,
): Promise<BenchmarkCase> {
  const configuration = await pricingService.getActiveConfiguration(db, session);
  const confidence = confirmedConfidence(input.observation, input.anyUnsure);
  const pricingInput = reconcilePricingInput(
    { interiorCleaning: false, screens: true, tracks: true, hardWaterTreatment: "unsure" },
    input.confirmedCharacteristics,
  );
  const estimate = calculateEstimate(pricingInput, configuration, confidence);
  const wouldNeedReview =
    determineInitialQuoteStatus(
      { characteristics: input.confirmedCharacteristics, metadata: { confidence } },
      input.observation,
    ) === "needs_review";

  const evidenceMessages = describeEvidenceGaps(input.observation);

  return benchmarkRepo.saveBenchmarkCase(db, session.businessId, {
    testName: input.testName,
    address: input.address,
    propertyType: input.propertyType,
    testedAt: input.testedAt,
    notes: input.notes,
    conditions: input.conditions,
    photoCount: input.photoCount,
    previousCaseId: input.previousCaseId,
    groundTruth: input.groundTruth,
    ai: {
      observation: input.observation,
      windowCount: observedNumber(input.observation.windowCount),
      windowStatus: input.observation.windowCount.status,
      screenCount: observedNumber(input.observation.screens),
      screenStatus: input.observation.screens.status,
      stories: observedNumber(input.observation.stories),
      storiesStatus: input.observation.stories.status,
      overallConfidence: input.observation.overallConfidence,
      evidenceCoverage: input.observation.evidence.coverage,
      evidenceOverall: input.observation.evidence.overallEvidence,
      evidenceIssues: input.observation.evidence.issues,
      morePhotosRecommended: input.observation.evidence.overallEvidence !== "sufficient",
      evidenceMessages,
    },
    confirmed: {
      characteristics: input.confirmedCharacteristics,
      confidence,
      wouldNeedReview,
      estimate,
    },
  });
}

export async function listBenchmarkCases(db: Queryable, session: AuthSession): Promise<BenchmarkCase[]> {
  return benchmarkRepo.listBenchmarkCases(db, session.businessId);
}

export async function deleteBenchmarkCase(db: Queryable, session: AuthSession, id: string): Promise<void> {
  await benchmarkRepo.deleteBenchmarkCase(db, session.businessId, id);
}

// ============================================================================
// Metrics (Parts 4 & 5 of the mission brief) — pure functions over an
// already-loaded list of cases, deliberately independent of the database so
// they're trivial to unit test with hand-built fixtures.
// ============================================================================

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function rate(count: number, total: number): number | null {
  if (total === 0) return null;
  return count / total;
}

export interface BenchmarkConditionBreakdown {
  condition: BenchmarkCondition;
  count: number;
  avgAbsWindowError: number | null;
  exactCountRate: number | null;
  within1Rate: number | null;
}

export interface EvidenceTierBreakdown {
  tier: OverallEvidence;
  count: number;
  /** Of cases in this tier with ground truth, the fraction whose RAW AI window count was within ±1 — tests whether the AI's own "usable_with_uncertainty"/"insufficient" labeling actually correlates with worse accuracy. */
  within1Rate: number | null;
}

export interface FollowUpPhotoStats {
  /** Cases where the AI recommended additional photos (`overallEvidence !== "sufficient"`). */
  recommendedCount: number;
  /** Of those, how many were actually followed by a linked, improved re-run (`previousCaseId` pointing back at one of them). */
  followUpCasesCount: number;
  /** Of the linked follow-ups, how many had a strictly smaller absolute window error than the case they followed. */
  improvedCount: number;
}

export interface BenchmarkMetrics {
  totalCases: number;

  casesWithWindowGroundTruth: number;
  aiDeclinedToCountRate: number | null;
  /** Overcounts are tracked separately from recall precisely so a value >100% recall can never be misread as "good" — see the mission brief's Part 4. */
  avgRawRecall: number | null;
  overcountRate: number | null;
  avgAbsWindowError: number | null;
  exactCountRate: number | null;
  within1Rate: number | null;
  within2Rate: number | null;

  casesWithScreenGroundTruth: number;
  avgAbsScreenError: number | null;

  casesConfirmedWithWindowGroundTruth: number;
  avgAbsConfirmedWindowError: number | null;
  confirmedExactCountRate: number | null;

  evidenceBreakdown: EvidenceTierBreakdown[];
  followUpPhotos: FollowUpPhotoStats;
  byCondition: BenchmarkConditionBreakdown[];
}

function windowGroundTruthCases(cases: BenchmarkCase[]): BenchmarkCase[] {
  return cases.filter((c) => typeof c.groundTruth.windowCount === "number" && c.groundTruth.windowCount > 0);
}

function absWindowError(aiCount: number | undefined, gtCount: number): number | undefined {
  return typeof aiCount === "number" ? Math.abs(aiCount - gtCount) : undefined;
}

export function computeBenchmarkMetrics(cases: BenchmarkCase[]): BenchmarkMetrics {
  const withGt = windowGroundTruthCases(cases);
  const aiCounted = withGt.filter((c) => c.ai.windowStatus === "observed" && typeof c.ai.windowCount === "number");
  const declined = withGt.length - aiCounted.length;

  const recalls = aiCounted.map((c) => c.ai.windowCount! / c.groundTruth.windowCount!);
  const overcounts = aiCounted.filter((c) => c.ai.windowCount! > c.groundTruth.windowCount!);
  const absErrors = aiCounted.map((c) => Math.abs(c.ai.windowCount! - c.groundTruth.windowCount!));

  const withScreenGt = cases.filter((c) => typeof c.groundTruth.screenCount === "number");
  const screenAbsErrors = withScreenGt
    .filter((c) => typeof c.ai.screenCount === "number")
    .map((c) => Math.abs(c.ai.screenCount! - c.groundTruth.screenCount!));

  const confirmedAbsErrors = withGt.map((c) =>
    Math.abs(c.confirmed.characteristics.windowCount - c.groundTruth.windowCount!),
  );

  const evidenceTiers: OverallEvidence[] = ["sufficient", "usable_with_uncertainty", "insufficient"];
  const evidenceBreakdown: EvidenceTierBreakdown[] = evidenceTiers.map((tier) => {
    const tierCases = withGt.filter((c) => c.ai.evidenceOverall === tier && typeof c.ai.windowCount === "number");
    const within1 = tierCases.filter((c) => Math.abs(c.ai.windowCount! - c.groundTruth.windowCount!) <= 1);
    return { tier, count: cases.filter((c) => c.ai.evidenceOverall === tier).length, within1Rate: rate(within1.length, tierCases.length) };
  });

  const recommended = cases.filter((c) => c.ai.morePhotosRecommended);
  const followUps = cases.filter(
    (c) => c.previousCaseId && recommended.some((r) => r.id === c.previousCaseId),
  );
  const improved = followUps.filter((c) => {
    const prior = cases.find((p) => p.id === c.previousCaseId);
    if (!prior || typeof prior.groundTruth.windowCount !== "number") return false;
    const priorErr = absWindowError(prior.ai.windowCount, prior.groundTruth.windowCount);
    const nextErr = absWindowError(c.ai.windowCount, prior.groundTruth.windowCount);
    return priorErr !== undefined && nextErr !== undefined && nextErr < priorErr;
  });

  const allConditions = new Set<BenchmarkCondition>();
  for (const c of cases) for (const tag of c.conditions) allConditions.add(tag);
  const byCondition: BenchmarkConditionBreakdown[] = Array.from(allConditions).map((condition) => {
    const tagged = withGt.filter((c) => c.conditions.includes(condition) && typeof c.ai.windowCount === "number");
    const errors = tagged.map((c) => Math.abs(c.ai.windowCount! - c.groundTruth.windowCount!));
    return {
      condition,
      count: cases.filter((c) => c.conditions.includes(condition)).length,
      avgAbsWindowError: average(errors),
      exactCountRate: rate(errors.filter((e) => e === 0).length, errors.length),
      within1Rate: rate(errors.filter((e) => e <= 1).length, errors.length),
    };
  });

  return {
    totalCases: cases.length,
    casesWithWindowGroundTruth: withGt.length,
    aiDeclinedToCountRate: rate(declined, withGt.length),
    avgRawRecall: average(recalls),
    overcountRate: rate(overcounts.length, aiCounted.length),
    avgAbsWindowError: average(absErrors),
    exactCountRate: rate(absErrors.filter((e) => e === 0).length, absErrors.length),
    within1Rate: rate(absErrors.filter((e) => e <= 1).length, absErrors.length),
    within2Rate: rate(absErrors.filter((e) => e <= 2).length, absErrors.length),
    casesWithScreenGroundTruth: withScreenGt.length,
    avgAbsScreenError: average(screenAbsErrors),
    casesConfirmedWithWindowGroundTruth: withGt.length,
    avgAbsConfirmedWindowError: average(confirmedAbsErrors),
    confirmedExactCountRate: rate(confirmedAbsErrors.filter((e) => e === 0).length, confirmedAbsErrors.length),
    evidenceBreakdown,
    followUpPhotos: {
      recommendedCount: recommended.length,
      followUpCasesCount: followUps.length,
      improvedCount: improved.length,
    },
    byCondition,
  };
}

// Re-exported so apps/app never needs to import AccessibilityLevel from
// @tallyvis/types just to type a ground-truth field — small convenience,
// not a new type.
export type { AccessibilityLevel };
