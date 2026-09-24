import type { ServicePreferences } from "./types";

export interface ServiceQuestion {
  key: keyof Omit<ServicePreferences, "hardWaterTreatment">;
  label: string;
  helpText?: string;
}

/**
 * Per-industry estimator configuration: the questions asked, photo
 * guidance copy, and photo-count limits. Window cleaning is the only
 * vertical implemented — see docs/product for the others planned. Adding a
 * new vertical means adding another object to INDUSTRY_CONFIGS below, not
 * branching logic through the estimator pages.
 */
export interface IndustryConfig {
  vertical: "window-cleaning";
  displayName: string;
  minPhotos: number;
  maxPhotos: number;
  photoIntro: string;
  photoGuidance: string[];
  serviceQuestions: ServiceQuestion[];
}

export const windowCleaningEstimatorConfig: IndustryConfig = {
  vertical: "window-cleaning",
  displayName: "Window Cleaning",
  minPhotos: 3,
  /**
   * Mirrors services/api/src/services/aiAnalysis.ts's own MAX_IMAGES (the
   * authoritative server-side limit — this one is UX guidance only). Each
   * photo is compressed client-side before upload (see
   * apps/app/src/lib/imageCompression.ts) specifically to fit within
   * Vercel Functions' hard 4.5MB total request body limit once
   * base64-encoded — see that file's own top comment for the full
   * request-budget accounting this count is derived from, and
   * next.config.ts for the matching `bodySizeLimit`.
   */
  maxPhotos: 6,
  photoIntro: "Help Tallyvis see your property",
  /**
   * Vision V1.1 (docs/decisions/0023-guided-capture-evidence-confidence.md)
   * — real customer photos are commonly distant, partially obstructed, or
   * incomplete; the goal here is a fast, concrete nudge toward better
   * evidence, not a photography tutorial. Deliberately kept to a handful of
   * short lines — see that ADR for why a longer guide was rejected.
   */
  photoGuidance: [
    "Start with a full view of the property.",
    "Then take closer photos of each visible side.",
    "Make sure windows are large enough in the photo to see clearly.",
    "A few branches or a parked car are fine — just avoid photos where they block most of a wall.",
    "Different angles can overlap — that's okay, we'll sort it out.",
  ],
  serviceQuestions: [
    {
      key: "interiorCleaning",
      label: "Interior window cleaning",
      helpText: "Clean the inside of accessible windows, not just the outside.",
    },
    { key: "screens", label: "Clean window screens" },
    { key: "tracks", label: "Clean window tracks" },
  ],
};

const INDUSTRY_CONFIGS: Record<string, IndustryConfig> = {
  "window-cleaning": windowCleaningEstimatorConfig,
};

export function getIndustryConfig(vertical: string): IndustryConfig {
  const config = INDUSTRY_CONFIGS[vertical];
  if (!config) {
    throw new Error(`No estimator configuration for vertical "${vertical}".`);
  }
  return config;
}
