import type { ServicePreferences, WindowCleaningCharacteristics } from "@tallyvis/types";

/**
 * Reconciles what the AI observed with what the customer actually asked
 * for, producing the characteristics the pricing engine should charge
 * against. Originally an apps/app-local helper (see
 * docs/decisions/0006-estimator-data-pipeline.md); moved here in Phase 9
 * because `services/api`'s server-side quote pricing needs the exact same
 * reconciliation the browser's live estimate preview uses — one rule set,
 * usable from both sides of that boundary, not two copies of it.
 *
 * Example: the analyzer might detect 12 screens present, but if the
 * customer didn't request screen cleaning, pricing shouldn't charge for it
 * — so screens is zeroed out here rather than in `calculateWindowCleaningEstimate`.
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
