import type {
  AccessibilityLevel,
  ConditionLevel,
  ConfidenceLevel,
  PropertyAnalysisResult,
  PropertyImage,
  PropertyMetadata,
  WindowCleaningCharacteristics,
} from "@tallyvis/types";

/**
 * The AI provider abstraction. Any analyzer (mock or real computer vision
 * model) implements this exact signature, so the rest of the app never
 * depends on which provider is behind it.
 */
export type AnalyzeProperty = (
  images: PropertyImage[],
  metadata: PropertyMetadata,
) => Promise<PropertyAnalysisResult>;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * ============================== MOCK ANALYZER ==============================
 * This is a deterministic, heuristic stand-in for real computer vision —
 * NOT actual image analysis. Nothing here looks at pixel data. It exists so
 * the rest of the product (the customer estimator in apps/app, the pricing
 * engine) can be built and demonstrated end-to-end before a real
 * computer-vision model exists (planned for a future phase).
 *
 * A real implementation would replace this function's body only — the
 * `AnalyzeProperty` signature and `PropertyAnalysisResult` shape it returns
 * are the actual integration contract and would not need to change.
 * ============================================================================
 */
async function mockAnalyzeProperty(
  images: PropertyImage[],
  metadata: PropertyMetadata,
): Promise<PropertyAnalysisResult> {
  // Simulate processing latency so callers that show a progress sequence
  // have something real to wait on rather than an instant resolve.
  await new Promise((resolve) => setTimeout(resolve, 350));

  const photoCount = images.length;

  let confidence: ConfidenceLevel;
  const notes: string[] = [];

  if (photoCount < 3) {
    confidence = "low";
    notes.push(
      "Only a few photos were provided — add more angles of the property for a more confident estimate.",
    );
  } else if (photoCount < 5) {
    confidence = "medium";
    notes.push(
      "A couple more photos would help confirm window count on every side of the property.",
    );
  } else {
    confidence = "high";
  }

  // A real model would determine stories from the photos themselves. The
  // mock leans on the customer's own answer since it has no other signal.
  const stories = clamp(metadata.customerDeclaredStories ?? 1, 1, 3);

  const accessibility: AccessibilityLevel =
    stories === 1 ? "easy" : stories === 2 ? "moderate" : "difficult";

  const windowCount = clamp(stories * 6 + Math.round(photoCount * 1.5), 4, 40);
  const screens = Math.round(windowCount * 0.4);
  const tracks = screens;
  const condition: ConditionLevel = photoCount >= 4 ? "fair" : "good";

  const accessMultiplier = accessibility === "easy" ? 1 : accessibility === "moderate" ? 1.3 : 1.6;
  const estimatedLaborHours =
    Math.round((windowCount * 0.08 + stories * 0.3) * accessMultiplier * 10) / 10;

  const characteristics: WindowCleaningCharacteristics = {
    vertical: "window-cleaning",
    windowCount,
    windowType: "double-hung",
    paneCount: 0,
    stories,
    screens,
    tracks,
    accessibility,
    condition,
    hardWaterStaining: false,
    estimatedLaborHours,
    interiorCleaning: false,
  };

  return {
    characteristics,
    metadata: { confidence, notes: notes.length > 0 ? notes : undefined },
  };
}

export const analyzeProperty: AnalyzeProperty = mockAnalyzeProperty;
