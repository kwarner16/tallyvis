import type { AiErrorCategory } from "./providers/types";

/**
 * Development-only operational visibility for AI analysis calls (Phase 12
 * — see docs/decisions/0014-ai-real-world-refinement.md). Not a billing
 * or usage-metering system, not persisted anywhere — just structured
 * console output an operator can grep/tail locally to answer "is this
 * working, how long does it take, how much does it cost." Every field
 * here is deliberately non-sensitive: no photos, no prompt text, no raw
 * provider response, no API key. `services/ai/src/index.ts`'s
 * `runAnalysis` is the only caller.
 */
export interface AnalysisLogEvent {
  provider: string;
  model?: string;
  success: boolean;
  latencyMs: number;
  imageCount: number;
  errorCategory?: AiErrorCategory;
  /** Server-log-only diagnostic detail (Anthropic's own request id/error message) — see AiProviderError.detail's own comment for why this is safe. */
  errorDetail?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export function logAnalysisEvent(event: AnalysisLogEvent): void {
  const line = {
    at: new Date().toISOString(),
    event: "ai-analysis",
    ...event,
  };
  if (event.success) console.log(JSON.stringify(line));
  else console.error(JSON.stringify(line));
}
