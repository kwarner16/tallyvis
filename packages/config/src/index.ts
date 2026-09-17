import type { WindowCleaningPricingRules } from "@tallyvis/types";

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
  basePrice: 50,
  pricePerWindow: 8,
  pricePerPane: 0,
  secondStorySurcharge: 40,
  screenCleaningPrice: 3,
  trackCleaningPrice: 2,
  hardWaterTreatmentPrice: 60,
  minimumJobPrice: 150,
  travelFee: 25,
  difficultyMultipliers: {
    easy: 1,
    moderate: 1.15,
    difficult: 1.35,
  },
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
