"use server";

import { revalidatePath } from "next/cache";
import {
  AiProviderError,
  analyzePropertyForBusiness,
  computeBenchmarkMetrics,
  deleteBenchmarkCase as apiDeleteBenchmarkCase,
  describeEvidenceGaps,
  listBenchmarkCases as apiListBenchmarkCases,
  saveBenchmarkCase as apiSaveBenchmarkCase,
  type AnalyzePropertyInput,
  type AnalyzePropertyResult,
  type BenchmarkCase,
  type BenchmarkMetrics,
  type SaveBenchmarkCaseInput,
} from "@tallyvis/api";
import { requireContext } from "./session";
import { describeAiErrorCategory } from "./aiErrorMessages";
import type { ActionResult } from "./actionResult";

/**
 * Final validation & launch-readiness phase (2026-09) — thin server-action
 * wrappers for the internal estimator benchmark harness
 * (/dashboard/testing), following the exact same pattern as
 * quoteActions.ts: `requireContext()` derives the business from the
 * session cookie, never from client input, and every action returns an
 * `ActionResult` rather than throwing (see actionResult.ts's own comment
 * on why).
 */

export interface BenchmarkAnalysisResult extends AnalyzePropertyResult {
  /** Same safe, pre-rendered follow-up-photo copy the public estimator's `analyzePublicPropertyAction` computes server-side — see that action's own comment for why this is never a client-side `describeEvidenceGaps` call. */
  evidenceMessages: string[];
}

/**
 * Runs a benchmark test case's photos through the exact same
 * `analyzePropertyForBusiness` pipeline the dashboard's "New quote" flow
 * already uses (`analyzePropertyAction` in quoteActions.ts) — this is
 * deliberately NOT a second AI implementation, just a second caller of the
 * same one. The only addition is computing `describeEvidenceGaps` here,
 * server-side, so the benchmark UI can show "would this request more
 * photos, and why" without importing AI runtime code into a client
 * component.
 */
export async function analyzeBenchmarkPhotosAction(input: AnalyzePropertyInput): Promise<ActionResult<BenchmarkAnalysisResult>> {
  const { db, session } = await requireContext();
  try {
    const result = await analyzePropertyForBusiness(db, session, input);
    return { ok: true, data: { ...result, evidenceMessages: describeEvidenceGaps(result.observation) } };
  } catch (err) {
    if (err instanceof AiProviderError) return { ok: false, message: describeAiErrorCategory(err.category) };
    console.error("[benchmarkActions] analyzeBenchmarkPhotosAction failed unexpectedly:", err instanceof Error ? err.message : "non-Error thrown");
    return { ok: false, message: describeAiErrorCategory("unknown") };
  }
}

export async function saveBenchmarkCaseAction(input: SaveBenchmarkCaseInput): Promise<ActionResult<BenchmarkCase>> {
  const { db, session } = await requireContext();
  try {
    const saved = await apiSaveBenchmarkCase(db, session, input);
    revalidatePath("/dashboard/testing");
    return { ok: true, data: saved };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Could not save this benchmark case." };
  }
}

export async function listBenchmarkCasesAction(): Promise<ActionResult<BenchmarkCase[]>> {
  const { db, session } = await requireContext();
  try {
    const cases = await apiListBenchmarkCases(db, session);
    return { ok: true, data: cases };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Could not load benchmark cases." };
  }
}

export async function deleteBenchmarkCaseAction(id: string): Promise<ActionResult<null>> {
  const { db, session } = await requireContext();
  try {
    await apiDeleteBenchmarkCase(db, session, id);
    revalidatePath("/dashboard/testing");
    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Could not delete this benchmark case." };
  }
}

/** Metrics are computed purely client-side-shaped (see computeBenchmarkMetrics), but run here so the page's initial load has them precomputed server-side. */
export async function getBenchmarkMetricsAction(): Promise<ActionResult<BenchmarkMetrics>> {
  const { db, session } = await requireContext();
  try {
    const cases = await apiListBenchmarkCases(db, session);
    return { ok: true, data: computeBenchmarkMetrics(cases) };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Could not compute benchmark metrics." };
  }
}
