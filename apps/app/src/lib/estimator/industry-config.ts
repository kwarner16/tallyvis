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
   * authoritative server-side limit — this one is UX guidance only). Both
   * were lowered from 8 together with each photo's own size limit (see
   * EstimatorContext.tsx's MAX_PHOTO_SIZE_BYTES) after confirming Vercel
   * Functions have a hard 4.5MB total request body limit, platform-enforced
   * before this app's own code (or its own, more generous
   * `bodySizeLimit` config) ever sees the request — a base64 data URI is
   * ~4/3 the size of the original photo, so the old 8-photo/10MB-each
   * limits could total over 100MB, guaranteeing a raw platform-level 413
   * this app has no way to intercept or explain. See next.config.ts.
   */
  maxPhotos: 6,
  photoIntro: "Show us the windows. We'll handle the rest.",
  photoGuidance: [
    "Take photos from outside the home.",
    "Try to include a full side of the house in each shot.",
    "Make sure the windows are clearly visible.",
    "A photo from a different angle helps if the property has more than one side.",
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
