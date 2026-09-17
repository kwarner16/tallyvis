import type { PropertyAnalysisResult, WindowCleaningCharacteristics } from "@tallyvis/types";
import type { CustomerInput } from "./types";

/**
 * Reconciles what the AI observed with what the customer actually asked
 * for, producing the characteristics the pricing engine should charge
 * against. See docs/decisions/0006-estimator-data-pipeline.md.
 *
 * Example: the analyzer might detect 12 screens present, but if the
 * customer didn't request screen cleaning, pricing shouldn't charge for it
 * — so screens is zeroed out here rather than in packages/pricing.
 */
export function buildPricingInput(
  customerInput: CustomerInput,
  analysis: PropertyAnalysisResult,
): WindowCleaningCharacteristics {
  const observed = analysis.characteristics;
  const { services } = customerInput;

  const hardWaterStaining =
    services.hardWaterTreatment === "yes"
      ? true
      : services.hardWaterTreatment === "no"
        ? false
        : observed.hardWaterStaining;

  return {
    ...observed,
    screens: services.screens ? observed.screens : 0,
    tracks: services.tracks ? observed.tracks : 0,
    hardWaterStaining,
    interiorCleaning: services.interiorCleaning,
  };
}
