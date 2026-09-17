import type { PricingConfiguration, PricingValidationResult } from "@tallyvis/types";
import { validatePricingRules } from "./validatePricingRules";

/**
 * Validates the envelope fields around a `PricingConfiguration` (identity,
 * versioning, currency) and delegates the rate-card itself to
 * `validatePricingRules`. This is what `calculateEstimate` runs before
 * trusting a configuration, and what a dashboard's save action should run
 * before persisting a new version.
 */
export function validatePricingConfiguration(
  config: PricingConfiguration,
): PricingValidationResult {
  const errors: string[] = [];

  if (!config.id) errors.push("Pricing configuration is missing an id.");
  if (!config.businessId) errors.push("Pricing configuration is missing a businessId.");
  if (!config.currency) errors.push("Pricing configuration is missing a currency.");
  if (!Number.isInteger(config.version) || config.version < 1) {
    errors.push("Pricing configuration version must be a positive integer.");
  }
  if (!config.effectiveAt || Number.isNaN(Date.parse(config.effectiveAt))) {
    errors.push("Pricing configuration effectiveAt must be a valid date.");
  }

  if (!config.rules) {
    errors.push("Pricing configuration is missing rules.");
  } else if (config.rules.vertical === "window-cleaning") {
    const rulesResult = validatePricingRules(config.rules);
    errors.push(...rulesResult.errors);
  } else {
    errors.push(`Unsupported pricing configuration industry: "${config.industry}"`);
  }

  return { valid: errors.length === 0, errors };
}
