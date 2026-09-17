import type { ServicePreferences, WindowCleaningCharacteristics } from "@tallyvis/types";

/**
 * Reconciles what the AI observed with what the customer actually asked
 * for, producing the characteristics the pricing engine should charge
 * against. Shared by the estimator (fresh submissions) and the dashboard
 * (recalculating after a business owner edits the analysis) — there is
 * exactly one reconciliation rule set. See
 * docs/decisions/0006-estimator-data-pipeline.md.
 *
 * Example: the analyzer might detect 12 screens present, but if the
 * customer didn't request screen cleaning, pricing shouldn't charge for it
 * — so screens is zeroed out here rather than in packages/pricing.
 */
export function reconcilePricingInput(
  servicePreferences: ServicePreferences,
  observed: WindowCleaningCharacteristics,
): WindowCleaningCharacteristics {
  const hardWaterStaining =
    servicePreferences.hardWaterTreatment === "yes"
      ? true
      : servicePreferences.hardWaterTreatment === "no"
        ? false
        : observed.hardWaterStaining;

  return {
    ...observed,
    screens: servicePreferences.screens ? observed.screens : 0,
    tracks: servicePreferences.tracks ? observed.tracks : 0,
    hardWaterStaining,
    interiorCleaning: servicePreferences.interiorCleaning,
  };
}
