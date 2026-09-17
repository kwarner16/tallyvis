import type { PropertyAnalysisResult, PropertyImage, PropertyMetadata } from "@tallyvis/types";

/**
 * The AI provider abstraction. Any analyzer (mock or real computer vision
 * model) implements this exact signature, so the rest of the app never
 * depends on which provider is behind it.
 *
 * NOT IMPLEMENTED YET. A mock implementation is planned for Phase 7; a real
 * computer-vision-backed implementation is planned for Phase 8. This file
 * exists in Phase 1 purely to lock in the interface shape so downstream code
 * (the pricing engine, the estimator UI) can be designed against it now.
 */
export type AnalyzeProperty = (
  images: PropertyImage[],
  metadata: PropertyMetadata,
) => Promise<PropertyAnalysisResult>;

export const analyzeProperty: AnalyzeProperty = async () => {
  throw new Error(
    "analyzeProperty() is not implemented yet. A mock implementation ships in Phase 7; " +
      "see docs/architecture/ai-abstraction.md and docs/decisions.",
  );
};
