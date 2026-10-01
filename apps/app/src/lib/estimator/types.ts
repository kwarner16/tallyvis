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
  /** The service/job address — required to get an estimate; see `isPropertyComplete`. */
  address: string;
}

export interface UploadedPhoto {
  id: string;
  previewUrl: string;
  name: string;
  sizeBytes: number;
}

/**
 * Minimal contact capture — collected on Review so the business has
 * someone to follow up with. `smsConsent` (Twilio A2P 10DLC compliance —
 * see docs/decisions/0029-sms-consent-and-a2p-10dlc.md) is a separate,
 * always-optional, unchecked-by-default flag: a customer can decline it
 * and still request a quote normally — see `isContactComplete` below,
 * which deliberately never requires it.
 */
export interface ContactDetails {
  name: string;
  email: string;
  phone: string;
  smsConsent: boolean;
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
  contact: { name: "", email: "", phone: "", smsConsent: false },
};

export function isPropertyComplete(property: PropertyDetails): boolean {
  return property.propertyType !== null && property.stories !== null && property.address.trim().length > 0;
}

export function isContactComplete(contact: ContactDetails): boolean {
  return contact.name.trim().length > 0 && /\S+@\S+\.\S+/.test(contact.email);
}

/**
 * Client-side mirror of `services/api/src/services/business.ts`'s
 * `normalizePhoneNumber` shape check — a bare 10-digit US number, one
 * already prefixed with "1" (11 digits), or an E.164 `+`-prefixed number.
 * This file is imported from a "use client" page (the estimator's contact
 * step), which can never import `services/api` (it pulls in `node:sqlite`
 * — see CLAUDE.md's module boundary rules), so the shape check is
 * duplicated here rather than shared. Used ONLY to gate the SMS opt-in
 * checkbox in the UI (see `ContactDetails.smsConsent`'s own comment) —
 * the server remains the authoritative gate regardless
 * (`createCustomerForBusiness` never records consent without a phone that
 * passes the real `normalizePhoneNumber`).
 */
export function isPlausiblePhoneNumber(phone: string): boolean {
  const trimmed = phone.trim();
  if (trimmed.startsWith("+")) return /^\+[1-9]\d{6,14}$/.test(trimmed);
  const digits = trimmed.replace(/[^\d]/g, "");
  return /^\d{10}$/.test(digits) || /^1\d{10}$/.test(digits);
}
