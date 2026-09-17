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
  maxPhotos: 8,
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
