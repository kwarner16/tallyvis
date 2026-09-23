import type { PropertyImage, PropertyMetadata } from "@tallyvis/types";

/**
 * What every provider (mock or real) must implement. `raw` is deliberately
 * `unknown`, not `RawPropertyObservation` — a provider's raw output is
 * untrusted until `validateObservation.ts` has checked it; a provider is
 * not trusted to validate its own output. `meta` is optional,
 * non-sensitive operational data (Phase 12 — see
 * docs/decisions/0014-ai-real-world-refinement.md) used only for the dev
 * logging `services/ai/src/logging.ts` emits — never persisted, never
 * containing photos, prompts, or credentials.
 */
export interface AiProviderResult {
  raw: unknown;
  meta?: {
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface AiProvider {
  /** For error messages and logging — never a secret, never provider-internal detail beyond a name. */
  readonly name: string;
  analyzeProperty(images: PropertyImage[], metadata: PropertyMetadata): Promise<AiProviderResult>;
}

/**
 * Thrown by a provider (instead of a bare `Error`) when it wants
 * `services/ai`'s logging to categorize the failure — e.g. distinguishing
 * "not configured" from "the provider rejected our credentials" from "the
 * provider is rate-limiting us" in dev logs and, ultimately, in what the
 * UI tells the business. `message` is always the safe, user-facing string
 * a caller can display as-is (never a raw SDK error, never a secret).
 */
export class AiProviderError extends Error {
  readonly category: AiErrorCategory;

  constructor(message: string, category: AiErrorCategory) {
    super(message);
    this.name = "AiProviderError";
    this.category = category;
  }
}

export type AiErrorCategory =
  | "not-configured"
  | "authentication"
  | "rate-limit"
  | "billing" // Anthropic's own documented `billing_error` type (insufficient credits/plan issue) — distinct from rate-limit: retrying immediately never helps, the account itself needs attention.
  | "overloaded" // Anthropic's own documented `overloaded_error` type — the model is temporarily at capacity, distinct from this account being rate-limited.
  | "model-not-found" // the configured AI_PROVIDER_MODEL isn't a valid/callable model id for this account — an operator misconfiguration, not a per-request failure a retry fixes.
  | "timeout"
  | "connection"
  | "provider-error"
  | "refusal"
  | "malformed-response"
  | "invalid-response" // failed validateRawPropertyObservation — set by services/ai/src/index.ts, not a provider
  | "too-many-images" // input-bounds categories — set by services/api/src/services/aiAnalysis.ts, not a provider
  | "image-too-large"
  | "invalid-image"
  | "unknown";
