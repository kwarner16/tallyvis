import type {
  ConfidenceLevel,
  Estimate,
  EstimateLineItem,
  WindowCleaningCharacteristics,
  WindowCleaningPricingRules,
} from "@tallyvis/types";

const CURRENCY = "USD";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
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
