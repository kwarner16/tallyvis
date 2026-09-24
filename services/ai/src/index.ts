import type { PropertyAnalysisResult, PropertyImage, PropertyMetadata } from "@tallyvis/types";
import type { RawPropertyObservation } from "./types";
import { AiProviderError, type AiProvider } from "./providers/types";
import { mockProvider } from "./providers/mock";
import { createAnthropicProvider } from "./providers/anthropic";
import { validateRawPropertyObservation, summarizeObservationForLogging } from "./validateObservation";
import { reconcileObservation } from "./reconcile";
import { logAnalysisEvent } from "./logging";

export type { ObservedValue, RawPropertyObservation } from "./types";
export {
  validateRawPropertyObservation,
  safeParseJson,
  summarizeObservationForLogging,
  type ValidationResult,
} from "./validateObservation";
export { reconcileObservation } from "./reconcile";
export {
  compareObservationToCharacteristics,
  wasObservationCorrected,
  type ObservationComparisonRow,
} from "./compareObservation";
export { AiProviderError, type AiProvider, type AiErrorCategory, type AiProviderResult } from "./providers/types";
export { mockProvider } from "./providers/mock";
export { createAnthropicProvider, type AnthropicProviderConfig } from "./providers/anthropic";

/**
 * The AI provider abstraction (Phase 11 — see
 * docs/decisions/0013-ai-analysis-foundation.md — refined in Phase 12,
 * docs/decisions/0014-ai-real-world-refinement.md). This file is the only
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
  throw new AiProviderError(`Unknown AI_PROVIDER "${selected}". Expected "mock" or "anthropic".`, "not-configured");
}

export interface AnalyzePropertyResult {
  analysis: PropertyAnalysisResult;
  observation: RawPropertyObservation;
}

/**
 * The full pipeline against an explicit provider: call it, validate its
 * raw output, reconcile into the app's stable analysis shape, and emit one
 * dev-visibility log line either way (Phase 12 — see the ADR above; never
 * logs photos, prompt text, the raw provider response, or credentials).
 * Exported separately from `analyzePropertyDetailed` so tests can exercise
 * this logic against a fake/mock provider without touching environment
 * variables — the env-based provider selection lives only in
 * `resolveProvider` above.
 */
export async function runAnalysis(
  provider: AiProvider,
  images: PropertyImage[],
  metadata: PropertyMetadata,
): Promise<AnalyzePropertyResult> {
  const startedAt = Date.now();
  let raw: unknown;
  let meta: { model?: string; inputTokens?: number; outputTokens?: number } | undefined;

  try {
    const result = await provider.analyzeProperty(images, metadata);
    raw = result.raw;
    meta = result.meta;
  } catch (err) {
    // Preserve the category (Phase 12 — see
    // docs/decisions/0014-ai-real-world-refinement.md) so callers up to the
    // UI can tell "not configured" from "rate limited" from "timed out"
    // apart, instead of collapsing every failure into one generic message.
    // Never let a raw non-AiProviderError (which could echo request
    // internals) reach the caller unfiltered — providers are responsible
    // for producing a safe message themselves (see providers/anthropic.ts);
    // this is the last line of defense if one doesn't.
    const wrapped =
      err instanceof AiProviderError
        ? err
        : new AiProviderError(
            err instanceof Error ? err.message : `The "${provider.name}" AI provider failed.`,
            "unknown",
          );
    logAnalysisEvent({
      provider: provider.name,
      model: provider.model,
      success: false,
      latencyMs: Date.now() - startedAt,
      imageCount: images.length,
      errorCategory: wrapped.category,
      errorDetail: wrapped.detail,
    });
    throw wrapped;
  }

  const validated = validateRawPropertyObservation(raw);
  if (!validated.ok) {
    // `validated.errors` here are only ever the small set of genuine
    // top-level structural messages (not a JSON object, wrong `vertical`)
    // — see validateObservation.ts's own comment on why this branch is now
    // narrow. Safe to log in full: no photos, no prompt text, no PII, just
    // a description of the malformed shape itself.
    logAnalysisEvent({
      provider: provider.name,
      model: meta?.model,
      success: false,
      latencyMs: Date.now() - startedAt,
      imageCount: images.length,
      errorCategory: "invalid-response",
      errorDetail: validated.errors.join(" "),
    });
    throw new AiProviderError(
      `The AI provider returned an invalid result: ${validated.errors.join(" ")}`,
      "invalid-response",
    );
  }

  logAnalysisEvent({
    provider: provider.name,
    model: meta?.model,
    success: true,
    latencyMs: Date.now() - startedAt,
    imageCount: images.length,
    inputTokens: meta?.inputTokens,
    outputTokens: meta?.outputTokens,
    observationSummary: summarizeObservationForLogging(validated.value),
  });

  return { analysis: reconcileObservation(validated.value, metadata), observation: validated.value };
}

/** The full pipeline against whichever provider `AI_PROVIDER` selects — the one function `services/api` calls. */
export async function analyzePropertyDetailed(
  images: PropertyImage[],
  metadata: PropertyMetadata,
): Promise<AnalyzePropertyResult> {
  const startedAt = Date.now();
  let provider: AiProvider;
  try {
    provider = resolveProvider();
  } catch (err) {
    // A misconfigured/unknown AI_PROVIDER never even reaches a provider —
    // still logged as a failed analysis attempt (section 12: "analysis
    // success/failure... error category"), since from the business's side
    // this is exactly what clicking "Analyze with AI" produced.
    const category = err instanceof AiProviderError ? err.category : "unknown";
    logAnalysisEvent({
      provider: "unresolved",
      success: false,
      latencyMs: Date.now() - startedAt,
      imageCount: images.length,
      errorCategory: category,
    });
    throw err;
  }

  return runAnalysis(provider, images, metadata);
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
