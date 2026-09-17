/**
 * Estimator-local types. These model what the CUSTOMER says (facts + service
 * preferences), not what the AI observes (packages/types' JobCharacteristics)
 * or what the business charges (packages/types' PricingRules) — see
 * docs/decisions/0006-estimator-data-pipeline.md for why those stay separate.
 */

export type PropertyType = "single-family" | "townhouse" | "other";

/** 3 represents "3 or more stories." */
export type StoriesInput = 1 | 2 | 3;

export type TriState = "yes" | "no" | "unsure";

export interface PropertyDetails {
  propertyType: PropertyType | null;
  stories: StoriesInput | null;
  /** Optional — not required to get an estimate. */
  address: string;
}

export interface ServicePreferences {
  interiorCleaning: boolean;
  screens: boolean;
  tracks: boolean;
  hardWaterTreatment: TriState;
}

export interface UploadedPhoto {
  id: string;
  previewUrl: string;
  name: string;
  sizeBytes: number;
}

export interface CustomerInput {
  property: PropertyDetails;
  services: ServicePreferences;
  photos: UploadedPhoto[];
  notes: string;
}

export const EMPTY_CUSTOMER_INPUT: CustomerInput = {
  property: { propertyType: null, stories: null, address: "" },
  services: {
    interiorCleaning: false,
    screens: false,
    tracks: false,
    hardWaterTreatment: "unsure",
  },
  photos: [],
  notes: "",
};

export function isPropertyComplete(property: PropertyDetails): boolean {
  return property.propertyType !== null && property.stories !== null;
}
