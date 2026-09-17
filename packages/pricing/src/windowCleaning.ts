import type {
  ConfidenceLevel,
  Estimate,
  EstimateLineItem,
  WindowCleaningCharacteristics,
  WindowCleaningPricingRules,
} from "@tallyvis/types";
import { roundMoney as round2 } from "./money";

const CURRENCY = "USD";

const NON_NEGATIVE_RULE_FIELDS = [
  "basePrice",
  "pricePerWindow",
  "pricePerPane",
  "secondStorySurcharge",
  "screenCleaningPrice",
  "trackCleaningPrice",
  "hardWaterTreatmentPrice",
  "interiorCleaningPrice",
  "minimumJobPrice",
  "travelFee",
] as const satisfies readonly (keyof WindowCleaningPricingRules)[];

const NON_NEGATIVE_CHARACTERISTIC_FIELDS = [
  "windowCount",
  "paneCount",
  "stories",
  "screens",
  "tracks",
  "estimatedLaborHours",
] as const satisfies readonly (keyof WindowCleaningCharacteristics)[];

/**
 * Defensive, low-level sanity checks — distinct from the user-facing
 * `validatePricingRules`/`validatePricingConfiguration` in this package.
 * Those exist to give a business owner a helpful error message before
 * saving a configuration; this exists so that if a malformed value ever
 * reaches the actual math (a bad default, a bug upstream, a future AI
 * output that wasn't sanity-checked), the engine fails loudly instead of
 * silently producing NaN/Infinity/negative prices. Every caller of
 * `calculateWindowCleaningEstimate` — including apps/web's direct calls —
 * is protected uniformly by this, without needing to remember to validate
 * first.
 */
function assertSanePricingInputs(
  characteristics: WindowCleaningCharacteristics,
  rules: WindowCleaningPricingRules,
): void {
  for (const field of NON_NEGATIVE_RULE_FIELDS) {
    const value = rules[field];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid pricing rule "${field}": expected a non-negative number, got ${value}`);
    }
  }

  for (const level of Object.keys(rules.difficultyMultipliers) as (keyof typeof rules.difficultyMultipliers)[]) {
    const value = rules.difficultyMultipliers[level];
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      throw new Error(
        `Invalid difficulty multiplier for "${level}": expected a positive number, got ${value}`,
      );
    }
  }

  for (const field of NON_NEGATIVE_CHARACTERISTIC_FIELDS) {
    const value = characteristics[field];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid characteristic "${field}": expected a non-negative number, got ${value}`);
    }
  }
}

/**
 * Pure pricing calculation for the window-cleaning vertical.
 *
 * This function has no knowledge of AI, HTTP, or the database — it only
 * turns structured job characteristics + a business's pricing rules into an
 * itemized estimate. This is the boundary the product principle "AI does not
 * invent the price" depends on: everything here is deterministic and
 * business-configured.
 */
export function calculateWindowCleaningEstimate(
  characteristics: WindowCleaningCharacteristics,
  rules: WindowCleaningPricingRules,
  confidence: ConfidenceLevel = "high",
): Estimate {
  assertSanePricingInputs(characteristics, rules);

  const lineItems: EstimateLineItem[] = [];

  lineItems.push({ label: "Base price", amount: rules.basePrice });

  if (characteristics.windowCount > 0 && rules.pricePerWindow > 0) {
    lineItems.push({
      label: `Windows (${characteristics.windowCount} x $${rules.pricePerWindow})`,
      amount: round2(characteristics.windowCount * rules.pricePerWindow),
    });
  }

  if (characteristics.paneCount > 0 && rules.pricePerPane > 0) {
    lineItems.push({
      label: `Panes (${characteristics.paneCount} x $${rules.pricePerPane})`,
      amount: round2(characteristics.paneCount * rules.pricePerPane),
    });
  }

  if (characteristics.stories >= 2 && rules.secondStorySurcharge > 0) {
    lineItems.push({
      label: "Second-story surcharge",
      amount: rules.secondStorySurcharge,
    });
  }

  if (characteristics.screens > 0 && rules.screenCleaningPrice > 0) {
    lineItems.push({
      label: `Screen cleaning (${characteristics.screens})`,
      amount: round2(characteristics.screens * rules.screenCleaningPrice),
    });
  }

  if (characteristics.tracks > 0 && rules.trackCleaningPrice > 0) {
    lineItems.push({
      label: `Track cleaning (${characteristics.tracks})`,
      amount: round2(characteristics.tracks * rules.trackCleaningPrice),
    });
  }

  if (characteristics.hardWaterStaining && rules.hardWaterTreatmentPrice > 0) {
    lineItems.push({
      label: "Hard-water treatment",
      amount: rules.hardWaterTreatmentPrice,
    });
  }

  if (characteristics.interiorCleaning && rules.interiorCleaningPrice > 0) {
    lineItems.push({
      label: "Interior cleaning",
      amount: rules.interiorCleaningPrice,
    });
  }

  const laborSubtotal = round2(lineItems.reduce((sum, item) => sum + item.amount, 0));

  const multiplier = rules.difficultyMultipliers[characteristics.accessibility] ?? 1;
  const afterDifficulty = round2(laborSubtotal * multiplier);

  if (multiplier !== 1) {
    lineItems.push({
      label: `Difficulty adjustment (${characteristics.accessibility}, x${multiplier})`,
      amount: round2(afterDifficulty - laborSubtotal),
    });
  }

  if (rules.travelFee > 0) {
    lineItems.push({ label: "Travel / equipment fee", amount: rules.travelFee });
  }

  const subtotal = round2(afterDifficulty + rules.travelFee);
  let total = subtotal;

  if (total < rules.minimumJobPrice) {
    lineItems.push({
      label: "Minimum job price adjustment",
      amount: round2(rules.minimumJobPrice - total),
    });
    total = rules.minimumJobPrice;
  }

  return {
    lineItems,
    subtotal,
    total: round2(total),
    currency: CURRENCY,
    confidence,
  };
}
