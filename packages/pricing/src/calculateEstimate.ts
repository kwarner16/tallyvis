import type { ConfidenceLevel, Estimate, JobCharacteristics, PricingConfiguration } from "@tallyvis/types";
import { calculateWindowCleaningEstimate } from "./windowCleaning";
import { validatePricingConfiguration } from "./validatePricingConfiguration";

/**
 * The single canonical entry point for turning structured job
 * characteristics into a priced `Estimate`. Every consumer — the customer
 * estimator, the business dashboard's quote detail and pricing preview, and
 * any future API or AI integration — should call this instead of reaching
 * for a vertical-specific function directly, so there is exactly one place
 * that decides "given this business's configuration, what does this job
 * cost."
 *
 * It validates the configuration up front (throwing with the itemized
 * validation errors) rather than letting a malformed configuration reach
 * the math — a configuration should only ever fail this check if it was
 * corrupted or constructed by hand outside the normal save path, since the
 * dashboard's save flow validates before persisting.
 */
export function calculateEstimate(
  characteristics: JobCharacteristics,
  configuration: PricingConfiguration,
  confidence: ConfidenceLevel = "high",
): Estimate {
  const validation = validatePricingConfiguration(configuration);
  if (!validation.valid) {
    throw new Error(`Cannot calculate an estimate from an invalid pricing configuration: ${validation.errors.join(" ")}`);
  }

  if (characteristics.vertical !== configuration.industry) {
    throw new Error(
      `Pricing configuration industry "${configuration.industry}" does not match characteristics vertical "${characteristics.vertical}".`,
    );
  }

  switch (characteristics.vertical) {
    case "window-cleaning":
      return calculateWindowCleaningEstimate(characteristics, configuration.rules, confidence);
    default: {
      const exhaustive: never = characteristics.vertical;
      throw new Error(`Unsupported vertical: ${exhaustive as string}`);
    }
  }
}
