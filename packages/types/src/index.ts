// Shared type contracts for Tallyvis.
//
// These types are the boundary between services/ai (which produces job
// characteristics) and packages/pricing (which consumes them). Neither side
// should depend on the other directly — both depend on this package instead.

export type ConfidenceLevel = "high" | "medium" | "low";

export type AccessibilityLevel = "easy" | "moderate" | "difficult";

export type ConditionLevel = "good" | "fair" | "poor";

export type WindowType =
  "single-hung" | "double-hung" | "casement" | "sliding" | "picture" | "bay" | "other";

/**
 * Structured job characteristics for the window-cleaning vertical.
 * This is the initial beachhead vertical; other verticals (pressure washing,
 * gutter cleaning, etc.) will get their own characteristics shape under
 * packages/config and a corresponding union member here.
 */
export interface WindowCleaningCharacteristics {
  vertical: "window-cleaning";
  windowCount: number;
  windowType: WindowType;
  paneCount: number;
  stories: number;
  screens: number;
  tracks: number;
  accessibility: AccessibilityLevel;
  condition: ConditionLevel;
  hardWaterStaining: boolean;
  estimatedLaborHours: number;
  /** Whether interior (inside-the-home) window cleaning is part of this job. */
  interiorCleaning: boolean;
}

/** Union of all vertical-specific job characteristics. Extend as new verticals are added. */
export type JobCharacteristics = WindowCleaningCharacteristics;

export interface AnalysisMetadata {
  confidence: ConfidenceLevel;
  /** Human-readable notes explaining the confidence score or flagging ambiguity. */
  notes?: string[];
}

/** The full result of analyzing a property's photos. */
export interface PropertyAnalysisResult {
  characteristics: JobCharacteristics;
  metadata: AnalysisMetadata;
}

export interface PropertyImage {
  url: string;
}

export interface PropertyMetadata {
  address?: string;
  vertical: JobCharacteristics["vertical"];
  /**
   * Customer-declared hints (e.g. self-reported story count) that an
   * analyzer MAY use as a heuristic input. A real computer-vision
   * implementation should verify these independently from photos rather
   * than trust them outright — they exist here for analyzers (like a mock)
   * that have no other way to estimate them.
   */
  customerDeclaredStories?: number;
}

export interface WindowCleaningPricingRules {
  vertical: "window-cleaning";
  basePrice: number;
  pricePerWindow: number;
  pricePerPane: number;
  secondStorySurcharge: number;
  screenCleaningPrice: number;
  trackCleaningPrice: number;
  hardWaterTreatmentPrice: number;
  interiorCleaningPrice: number;
  minimumJobPrice: number;
  travelFee: number;
  difficultyMultipliers: Record<AccessibilityLevel, number>;
}

/** Union of all vertical-specific pricing rule sets. Extend as new verticals are added. */
export type PricingRules = WindowCleaningPricingRules;

export interface EstimateLineItem {
  label: string;
  amount: number;
}

export interface Estimate {
  lineItems: EstimateLineItem[];
  subtotal: number;
  total: number;
  currency: string;
  /** Carried through from the analysis so the UI can render confidence-aware messaging. */
  confidence: ConfidenceLevel;
}

/**
 * ============================== Quote domain ==============================
 * Added in Phase 5 to connect the customer estimator (apps/app's /estimate/*)
 * to the business dashboard (apps/app's /dashboard/*) — see
 * docs/decisions/0008-quote-domain-model.md. These are pure type contracts;
 * the mock persistence implementing them lives in apps/app (app-local, since
 * it's the only current consumer) and will move to services/api once a real
 * backend exists.
 * ============================================================================
 */

export type PropertyType = "single-family" | "townhouse" | "other";

/** A customer's yes/no/unsure answer where "I don't know" is a meaningfully different answer than "no." */
export type TriState = "yes" | "no" | "unsure";

/**
 * What the customer asked to have done — distinct from what the AI observes
 * present on the property (packages/types' JobCharacteristics). A property
 * can have screens the AI detects while the customer never asked to have
 * them cleaned; pricing should reflect the latter, not just the former.
 */
export interface ServicePreferences {
  interiorCleaning: boolean;
  screens: boolean;
  tracks: boolean;
  hardWaterTreatment: TriState;
}

export interface Customer {
  name: string;
  email: string;
  phone?: string;
}

export interface Property {
  propertyType: PropertyType;
  stories: number;
  address?: string;
}

export interface QuotePhoto {
  id: string;
  url: string;
}

export type QuoteStatus =
  "new" | "needs_review" | "more_information" | "approved" | "sent" | "accepted" | "declined";

/**
 * Centralizes which status changes are sensible so no UI has to guess.
 * "declined" is reachable from every active state (a business can decline
 * at any point); terminal states ("accepted", "declined") have no forward
 * transitions.
 */
export const QUOTE_STATUS_TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  new: ["needs_review", "approved", "declined"],
  needs_review: ["approved", "more_information", "declined"],
  more_information: ["needs_review", "declined"],
  approved: ["sent", "declined"],
  sent: ["accepted", "declined"],
  accepted: [],
  declined: [],
};

export function canTransitionQuoteStatus(from: QuoteStatus, to: QuoteStatus): boolean {
  return QUOTE_STATUS_TRANSITIONS[from].includes(to);
}

/**
 * A single request-for-estimate flowing through the system. Customer and
 * property are embedded rather than referenced by id — this is a mock,
 * single-business, no-database prototype (see docs/decisions/0008); a real
 * backend would normalize these into their own tables.
 */
export interface Quote {
  id: string;
  businessId: string;
  customer: Customer;
  property: Property;
  servicePreferences: ServicePreferences;
  notes: string;
  photos: QuotePhoto[];
  analysis: PropertyAnalysisResult;
  estimate: Estimate;
  status: QuoteStatus;
  createdAt: string;
  updatedAt: string;
}
