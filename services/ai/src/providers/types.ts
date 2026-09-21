import type { PropertyImage, PropertyMetadata } from "@tallyvis/types";

/**
 * What every provider (mock or real) must implement. Deliberately returns
 * `unknown`, not `RawPropertyObservation` — a provider's raw output is
 * untrusted until `validateObservation.ts` has checked it; a provider is
 * not trusted to validate its own output. See
 * docs/decisions/0013-ai-analysis-foundation.md.
 */
export interface AiProvider {
  /** For error messages and logging — never a secret, never provider-internal detail beyond a name. */
  readonly name: string;
  analyzeProperty(images: PropertyImage[], metadata: PropertyMetadata): Promise<unknown>;
}
