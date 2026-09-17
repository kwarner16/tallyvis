/**
 * Estimator-local types. These model the wizard's in-progress draft — what
 * the CUSTOMER says (facts + service preferences) as they fill out the
 * form, not what the AI observes (packages/types' JobCharacteristics) or
 * what the business charges (packages/types' PricingRules) — see
 * docs/decisions/0006-estimator-data-pipeline.md for why those stay separate.
 *
 * PropertyType/TriState/ServicePreferences live in @tallyvis/types (promoted
 * there in Phase 5, see docs/decisions/0008-quote-domain-model.md) since a
 * submitted Quote needs the same shapes — re-exported here so nothing else
 * in this app has to change its imports.
 */
import type { PropertyType, ServicePreferences, TriState } from "@tallyvis/types";

export type { PropertyType, ServicePreferences, TriState };

/** 3 represents "3 or more stories." */
export type StoriesInput = 1 | 2 | 3;

export interface PropertyDetails {
  propertyType: PropertyType | null;
  stories: StoriesInput | null;
  /** Optional — not required to get an estimate. */
  address: string;
}

export interface UploadedPhoto {
  id: string;
  previewUrl: string;
  name: string;
  sizeBytes: number;
}

/** Minimal contact capture — collected on Review so the business has someone to follow up with. */
export interface ContactDetails {
  name: string;
  email: string;
  phone: string;
}

export interface CustomerInput {
  property: PropertyDetails;
  services: ServicePreferences;
  photos: UploadedPhoto[];
  notes: string;
  contact: ContactDetails;
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
  contact: { name: "", email: "", phone: "" },
};

export function isPropertyComplete(property: PropertyDetails): boolean {
  return property.propertyType !== null && property.stories !== null;
}

export function isContactComplete(contact: ContactDetails): boolean {
  return contact.name.trim().length > 0 && /\S+@\S+\.\S+/.test(contact.email);
}
