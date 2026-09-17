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

/**
 * A single, versioned, business-owned pricing configuration. This is the
 * envelope around `PricingRules` that makes pricing business-specific and
 * versioned rather than a single global rate card — see
 * docs/decisions/0009-pricing-configuration-versioning.md.
 *
 * `calculateEstimate()` in packages/pricing is the only function that should
 * ever consume one of these; nothing else should read `.rules` directly and
 * re-derive a price.
 */
export interface PricingConfiguration {
  id: string;
  businessId: string;
  industry: PricingRules["vertical"];
  currency: string;
  /** Monotonically increasing per business, starting at 1. Never mutated in place. */
  version: number;
  /** ISO timestamp this version became the active configuration. */
  effectiveAt: string;
  rules: PricingRules;
}

/** The result of validating a `PricingRules` or `PricingConfiguration` before it can be saved or used. */
export interface PricingValidationResult {
  valid: boolean;
  /** Human-readable, field-specific problems. Empty when `valid` is true. */
  errors: string[];
}

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
 * the real, persisted implementation lives in services/api (SQLite-backed
 * since Phase 9 — see docs/decisions/0011-persistence-auth-and-multi-tenancy.md),
 * not in apps/app, which only ever reaches it through services/api's
 * session-scoped service layer.
 * ============================================================================
 */

/**
 * A real, persisted Tallyvis tenant (added in Phase 9 — see
 * docs/decisions/0011-persistence-auth-and-multi-tenancy.md). Every
 * business-owned record (`Customer`, `Quote`, `PricingConfiguration`)
 * carries this id as its `businessId`, and every data-access function in
 * `services/api` scopes its query by it. Supersedes `packages/config`'s
 * `DemoBusiness`, which remains only as seed data for local development,
 * never as a production data source.
 */
export interface Business {
  id: string;
  name: string;
  email: string;
  phone: string;
  serviceArea: string;
  defaultIndustry: "window-cleaning";
  createdAt: string;
}

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

/**
 * What's collected before a `Customer` record exists — no `id` yet, since
 * the caller doesn't get to decide it (see `Customer`). Used wherever a UI
 * gathers a customer's details as part of creating something else (a
 * quote), not managing the customer record directly.
 */
export interface CustomerInput {
  name: string;
  email: string;
  phone?: string;
}

/**
 * A business-owned customer record (added in Phase 9 — see
 * docs/decisions/0011-persistence-auth-and-multi-tenancy.md). Normalized
 * into its own table rather than only ever embedded on a `Quote`, so one
 * customer can have more than one quote and a business can be queried for
 * "this customer's quotes." `businessId` is the multi-tenant boundary:
 * never trust one supplied by a client, only the one derived from the
 * authenticated session.
 */
export interface Customer extends CustomerInput {
  id: string;
  businessId: string;
  /** A default service/job address for this customer — distinct from a specific quote's `Property.address`, which may differ per job. */
  address?: string;
  createdAt: string;
  updatedAt: string;
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
 * A single request-for-estimate flowing through the system. `customerId`
 * is the real foreign key a repository must use for multi-tenant scoping
 * and ownership checks; `customer` is that same customer's current record,
 * hydrated alongside it for convenience so every existing consumer that
 * reads `quote.customer.name` keeps working unchanged (see
 * docs/decisions/0011-persistence-auth-and-multi-tenancy.md). `property` is
 * still embedded rather than normalized — it's job-specific, not a record
 * with an identity or lifecycle of its own the way a customer has.
 */
export interface Quote {
  id: string;
  businessId: string;
  customerId: string;
  customer: Customer;
  property: Property;
  servicePreferences: ServicePreferences;
  notes: string;
  photos: QuotePhoto[];
  analysis: PropertyAnalysisResult;
  estimate: Estimate;
  /**
   * The exact pricing configuration version used to price this quote,
   * pinned at creation time. Re-pricing an existing quote (e.g. after
   * editing its analyzed characteristics) must look up this specific
   * version rather than whatever configuration is currently active, so a
   * business changing its prices does not retroactively change quotes that
   * already exist.
   */
  pricingConfigId: string;
  status: QuoteStatus;
  createdAt: string;
  updatedAt: string;
}
