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
