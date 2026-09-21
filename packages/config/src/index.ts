import type { PricingConfiguration, WindowCleaningPricingRules } from "@tallyvis/types";

export {
  PLANS,
  TRIAL_DAYS,
  PROFESSIONAL_INSTALLATION_FEE,
  getPlan,
  isPlanId,
  type Plan,
  type PlanId,
} from "./plans";

/**
 * Default pricing rules for the window-cleaning vertical.
 *
 * These are starting defaults only — in the real product, each business
 * configures its own values through the (future) business dashboard. This
 * config exists so a vertical's shape and reasonable starting values are
 * defined in one place rather than hard-coded across the app.
 */
export const windowCleaningDefaultPricingRules: WindowCleaningPricingRules = {
  vertical: "window-cleaning",
  basePrice: 125,
  pricePerWindow: 8,
  pricePerPane: 0,
  secondStorySurcharge: 35,
  screenCleaningPrice: 3,
  trackCleaningPrice: 4,
  hardWaterTreatmentPrice: 60,
  interiorCleaningPrice: 45,
  minimumJobPrice: 175,
  travelFee: 25,
  difficultyMultipliers: {
    easy: 1,
    moderate: 1.15,
    difficult: 1.35,
  },
};

export interface DemoBusiness {
  id: string;
  name: string;
  vertical: "window-cleaning";
}

/**
 * A clearly-labeled demo business — never a real Tallyvis customer and
 * never a production data source. Since Phase 9 gave `services/api` real
 * businesses backed by SQLite, this exists for exactly one purpose: naming
 * the demo tenant that `services/api`'s dev seed script creates
 * (`pnpm --filter @tallyvis/api seed`). Anything a running app reads comes
 * from the database, not from here. See
 * docs/decisions/0011-persistence-auth-and-multi-tenancy.md.
 */
export const demoBusiness: DemoBusiness = {
  id: "demo-window-cleaning-co",
  name: "Demo Window Cleaning Co.",
  vertical: "window-cleaning",
};

/**
 * The demo business's starting pricing configuration — version 1, effective
 * from a fixed point in the past. Illustrative only: since Phase 9, a real
 * business's version-1 configuration is a database row created at signup
 * from `windowCleaningDefaultPricingRules` (see `services/api`'s `signUp`),
 * and the `localStorage` mock store this used to seed no longer exists. Kept
 * as a ready-made `PricingConfiguration` literal for docs and examples that
 * need one without a database. See
 * docs/decisions/0009-pricing-configuration-versioning.md.
 */
export const demoPricingConfiguration: PricingConfiguration = {
  id: "demo-window-cleaning-co-pricing-v1",
  businessId: demoBusiness.id,
  industry: "window-cleaning",
  currency: "USD",
  version: 1,
  effectiveAt: "2025-01-01T00:00:00.000Z",
  rules: windowCleaningDefaultPricingRules,
};

export interface VerticalConfig {
  key: string;
  label: string;
  /** Whether this vertical has a real pricing/AI implementation or is planned for later. */
  status: "active" | "planned";
}

/**
 * Registry of service verticals Tallyvis targets. Only "window-cleaning" is
 * active in Phase 1; the rest are placeholders documenting intended future
 * expansion (see docs/product) and must not be treated as implemented.
 */
export const verticals: Record<string, VerticalConfig> = {
  "window-cleaning": { key: "window-cleaning", label: "Window Cleaning", status: "active" },
  "pressure-washing": { key: "pressure-washing", label: "Pressure Washing", status: "planned" },
  "gutter-cleaning": { key: "gutter-cleaning", label: "Gutter Cleaning", status: "planned" },
  roofing: { key: "roofing", label: "Roofing", status: "planned" },
  landscaping: { key: "landscaping", label: "Landscaping", status: "planned" },
  painting: { key: "painting", label: "Painting", status: "planned" },
  "junk-removal": { key: "junk-removal", label: "Junk Removal", status: "planned" },
  solar: { key: "solar", label: "Solar", status: "planned" },
  "property-maintenance": {
    key: "property-maintenance",
    label: "Property Maintenance",
    status: "planned",
  },
};

export type VerticalKey = keyof typeof verticals;
