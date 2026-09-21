import type { ConfidenceLevel, PropertyImage, PropertyMetadata } from "@tallyvis/types";
import type { AiProvider, AiProviderResult } from "./types";

/**
 * ============================== MOCK PROVIDER ==============================
 * A deterministic, heuristic stand-in for real computer vision — NOT
 * actual image analysis. Nothing here looks at pixel data; it reasons
 * only from photo count and the customer's self-reported story count,
 * exactly as the Phase 4 mock (`docs/decisions/0005-mock-analyzer-in-
 * phase-4.md`) always did. This is the default provider (`AI_PROVIDER`
 * unset or `"mock"`) so local development and this environment's tests
 * work with no API key configured.
 *
 * Its output goes through the exact same `validateRawPropertyObservation`
 * / `reconcileObservation` pipeline a real provider's output does — the
 * mock is a genuine implementation of `AiProvider`, not a special case the
 * rest of the package treats differently. Fields the mock has no real
 * signal for (`hardWaterStaining`) are honestly reported as `"unknown"`
 * rather than a fabricated guess — see
 * docs/decisions/0013-ai-analysis-foundation.md for why that matters.
 * ==============================================================================
 */

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function analyzeProperty(images: PropertyImage[], metadata: PropertyMetadata): Promise<AiProviderResult> {
  // Simulate processing latency so callers that show a progress sequence
  // have something real to wait on rather than an instant resolve.
  await new Promise((resolve) => setTimeout(resolve, 350));

  const photoCount = images.length;

  let confidence: ConfidenceLevel;
  const warnings: string[] = [];
  if (photoCount < 3) {
    confidence = "low";
    warnings.push("Only a few photos were provided — add more angles of the property for a more confident estimate.");
  } else if (photoCount < 5) {
    confidence = "medium";
    warnings.push("A couple more photos would help confirm window count on every side of the property.");
  } else {
    confidence = "high";
  }

  const stories = clamp(metadata.customerDeclaredStories ?? 1, 1, 3);
  const accessibility = stories === 1 ? "easy" : stories === 2 ? "moderate" : "difficult";
  const windowCount = clamp(stories * 6 + Math.round(photoCount * 1.5), 4, 40);
  const screens = Math.round(windowCount * 0.4);
  const condition = photoCount >= 4 ? "fair" : "good";

  return {
    raw: {
      vertical: "window-cleaning",
      stories: { status: "observed", value: stories, confidence },
      windowCount: { status: "observed", value: windowCount, confidence },
      windowType: { status: "observed", value: "double-hung", confidence },
      screens: { status: "observed", value: screens, confidence },
      tracks: { status: "observed", value: screens, confidence },
      accessibility: { status: "observed", value: accessibility, confidence },
      condition: { status: "observed", value: condition, confidence },
      hardWaterStaining: { status: "unknown" }, // no real signal — never fabricated as a false "observation"
      overallConfidence: confidence,
      warnings,
    },
    meta: { model: "mock-heuristic-v1" },
  };
}

export const mockProvider: AiProvider = {
  name: "mock",
  analyzeProperty,
};
