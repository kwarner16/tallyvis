import fs from "node:fs";
import path from "node:path";
import type { PropertyAnalysisResult, PropertyImage, PropertyMetadata } from "@tallyvis/types";
import type { RawPropertyObservation } from "./types";
import { AiProviderError, type AiProvider, type AiProviderResultMeta } from "./providers/types";
import { mockProvider } from "./providers/mock";
import { createAnthropicProvider } from "./providers/anthropic";
import { validateRawPropertyObservation, summarizeObservationForLogging } from "./validateObservation";
import { reconcileObservation } from "./reconcile";
import { logAnalysisEvent } from "./logging";

export type {
  ObservedValue,
  RawPropertyObservation,
  EvidenceAssessment,
  EvidenceCoverage,
  EvidenceIssue,
  OverallEvidence,
} from "./types";
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
export { describeEvidenceGaps } from "./evidenceMessages";
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
 * Development/benchmark-only diagnostic: writes the EXACT compressed image
 * bytes about to be sent to the AI provider to a local directory, so a
 * developer can visually compare "original photo" against "what Anthropic
 * actually received" (2026-09 "obvious window" incident audit — see
 * docs/decisions/0025). Deliberately narrow and belt-and-suspenders safe:
 *
 * - Off by default — requires `AI_DIAGNOSTIC_IMAGE_DIR` to be explicitly
 *   set to a local path. No such variable is ever set in any deployed
 *   (Vercel) environment.
 * - Hard-blocked whenever `NODE_ENV === "production"`, regardless of the
 *   env var — a defense-in-depth second gate, not just documentation, so a
 *   mis-set env var in a real deployment still can't turn this on.
 * - Writes to LOCAL DISK only — never a network call, never a database
 *   row, never retained beyond whatever the developer's own filesystem
 *   already does. Never touches `logAnalysisEvent` — the one line this
 *   emits names a directory and a count, never a data URI/base64 string.
 * - One process's temp/benchmark directory, one developer's own local run
 *   — not a shared or multi-tenant location, so it can't leak one
 *   business's photo to another the way a shared production log stream
 *   could.
 *
 * A failure here (bad directory, disk full, malformed data URI) must never
 * break real analysis — swallowed, not rethrown.
 */
export function maybeWriteDiagnosticImages(images: PropertyImage[]): void {
  const dir = process.env.AI_DIAGNOSTIC_IMAGE_DIR;
  if (!dir || process.env.NODE_ENV === "production") return;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const stamp = Date.now();
    let written = 0;
    images.forEach((image, i) => {
      const match = /^data:image\/([a-zA-Z0-9.+-]+);base64,([\s\S]+)$/.exec(image.url);
      if (!match?.[1] || !match[2]) return;
      const [, subtype, data] = match;
      const ext = subtype === "jpeg" ? "jpg" : subtype.replace(/[^a-z0-9]/gi, "");
      fs.writeFileSync(path.join(dir, `ai-diagnostic-${stamp}-${i}.${ext}`), Buffer.from(data, "base64"));
      written++;
    });
    if (written > 0) {
      // Safe: a directory path and a count, never the image content itself.
      console.log(`[ai-diagnostic] wrote ${written} compressed image(s) to ${dir} for local inspection (dev/test only).`);
    }
  } catch {
    // Never let a diagnostic-write failure affect a real analysis attempt.
  }
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
  maybeWriteDiagnosticImages(images);
  const startedAt = Date.now();
  let raw: unknown;
  let meta: AiProviderResultMeta | undefined;

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
      requestId: meta?.requestId,
      stopReason: meta?.stopReason,
      toolUseFound: meta?.toolUseFound,
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
    requestId: meta?.requestId,
    stopReason: meta?.stopReason,
    toolUseFound: meta?.toolUseFound,
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
