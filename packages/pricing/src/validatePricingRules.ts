import type { PricingValidationResult, WindowCleaningPricingRules } from "@tallyvis/types";

const PRICE_FIELDS: { key: keyof WindowCleaningPricingRules; label: string }[] = [
  { key: "basePrice", label: "Base price" },
  { key: "pricePerWindow", label: "Price per window" },
  { key: "pricePerPane", label: "Price per pane" },
  { key: "secondStorySurcharge", label: "Second-story surcharge" },
  { key: "screenCleaningPrice", label: "Screen cleaning price" },
  { key: "trackCleaningPrice", label: "Track cleaning price" },
  { key: "hardWaterTreatmentPrice", label: "Hard-water treatment price" },
  { key: "interiorCleaningPrice", label: "Interior cleaning price" },
  { key: "minimumJobPrice", label: "Minimum job price" },
  { key: "travelFee", label: "Travel / equipment fee" },
];

const DIFFICULTY_LEVELS: { key: keyof WindowCleaningPricingRules["difficultyMultipliers"]; label: string }[] = [
  { key: "easy", label: "Easy" },
  { key: "moderate", label: "Moderate" },
  { key: "difficult", label: "Difficult" },
];

/**
 * User-facing validation for a business's rate card, run before it's ever
 * saved or handed to the pricing engine. Distinct from the low-level
 * NaN/negative guards inside `calculateWindowCleaningEstimate` itself: this
 * produces one message per problem so a dashboard form can show a business
 * owner exactly what to fix, rather than a single thrown error.
 */
export function validatePricingRules(rules: WindowCleaningPricingRules): PricingValidationResult {
  const errors: string[] = [];

  if (rules.vertical !== "window-cleaning") {
    errors.push(`Unsupported vertical: "${rules.vertical}"`);
  }

  for (const { key, label } of PRICE_FIELDS) {
    const value = rules[key];
    if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
      errors.push(`${label} must be a number.`);
    } else if (value < 0) {
      errors.push(`${label} cannot be negative.`);
    }
  }

  if (!rules.difficultyMultipliers || typeof rules.difficultyMultipliers !== "object") {
    errors.push("Difficulty multipliers are missing.");
  } else {
    for (const { key, label } of DIFFICULTY_LEVELS) {
      const value = rules.difficultyMultipliers[key];
      if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
        errors.push(`${label} difficulty multiplier must be a number.`);
      } else if (value <= 0) {
        errors.push(`${label} difficulty multiplier must be greater than zero.`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
