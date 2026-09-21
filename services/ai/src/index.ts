import type { PropertyAnalysisResult, PropertyImage, PropertyMetadata } from "@tallyvis/types";
import type { RawPropertyObservation } from "./types";
import type { AiProvider } from "./providers/types";
import { mockProvider } from "./providers/mock";
import { createAnthropicProvider } from "./providers/anthropic";
import { validateRawPropertyObservation } from "./validateObservation";
import { reconcileObservation } from "./reconcile";

export type { ObservedValue, RawPropertyObservation } from "./types";
export { validateRawPropertyObservation, safeParseJson, type ValidationResult } from "./validateObservation";
export { reconcileObservation } from "./reconcile";
export type { AiProvider } from "./providers/types";
export { mockProvider } from "./providers/mock";
export { createAnthropicProvider, type AnthropicProviderConfig } from "./providers/anthropic";

/**
 * The AI provider abstraction (Phase 11 — see
 * docs/decisions/0013-ai-analysis-foundation.md). This file is the only
 * place `AI_PROVIDER`/`AI_PROVIDER_API_KEY`/`AI_PROVIDER_MODEL` are read —
 * everything else in this package is pure w.r.t. configuration. Callers
 * outside this package (`services/api`) never see a provider directly,
 * only `analyzeProperty`/`analyzePropertyDetailed` below.
 */

function resolveProvider(): AiProvider {
  const selected = process.env.AI_PROVIDER?.trim() || "mock";
  if (selected === "mock") return mockProvider;
  if (selected === "anthropic") {
    return createAnthropicProvider({
      apiKey: process.env.AI_PROVIDER_API_KEY ?? "",
      model: process.env.AI_PROVIDER_MODEL,
    });
  }
  throw new Error(`Unknown AI_PROVIDER "${selected}". Expected "mock" or "anthropic".`);
}

export interface AnalyzePropertyResult {
  analysis: PropertyAnalysisResult;
  observation: RawPropertyObservation;
}

/**
 * The full pipeline against an explicit provider: call it, validate its
 * raw output, reconcile into the app's stable analysis shape. Exported
 * separately from `analyzePropertyDetailed` so tests can exercise this
 * logic against a fake/mock provider without touching environment
 * variables — the env-based provider selection lives only in
 * `resolveProvider` above.
 */
export async function runAnalysis(
  provider: AiProvider,
  images: PropertyImage[],
  metadata: PropertyMetadata,
): Promise<AnalyzePropertyResult> {
  let raw: unknown;
  try {
    raw = await provider.analyzeProperty(images, metadata);
  } catch (err) {
    // Never let a raw provider error (which could echo request internals)
    // reach the caller unfiltered — providers are responsible for
    // producing a safe message themselves (see providers/anthropic.ts);
    // this is the last line of defense if one doesn't.
    throw new Error(err instanceof Error ? err.message : `The "${provider.name}" AI provider failed.`);
  }

  const validated = validateRawPropertyObservation(raw);
  if (!validated.ok) {
    throw new Error(`The AI provider returned an invalid result: ${validated.errors.join(" ")}`);
  }

  return { analysis: reconcileObservation(validated.value, metadata), observation: validated.value };
}

/** The full pipeline against whichever provider `AI_PROVIDER` selects — the one function `services/api` calls. */
export async function analyzePropertyDetailed(
  images: PropertyImage[],
  metadata: PropertyMetadata,
): Promise<AnalyzePropertyResult> {
  return runAnalysis(resolveProvider(), images, metadata);
}

/**
 * The original Phase 1/4 public contract, preserved exactly — anything
 * that only ever needed the final `PropertyAnalysisResult` (not the raw
 * per-field observation) does not need to change. `services/api`'s
 * orchestration service is the only caller of `analyzePropertyDetailed`
 * above; everything else keeps using this.
 */
export type AnalyzeProperty = (images: PropertyImage[], metadata: PropertyMetadata) => Promise<PropertyAnalysisResult>;

export const analyzeProperty: AnalyzeProperty = async (images, metadata) =>
  (await analyzePropertyDetailed(images, metadata)).analysis;
