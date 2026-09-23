"use server";

import { revalidatePath } from "next/cache";
import type { PricingConfiguration, WindowCleaningPricingRules } from "@tallyvis/types";
import { saveNewPricingConfigurationVersion } from "@tallyvis/api";
import { requireContext } from "./session";
import type { ActionResult } from "./actionResult";

/**
 * `saveNewPricingConfigurationVersion` throws a hand-written validation
 * message ("Cannot save invalid pricing rules: ...") the business needs to
 * see verbatim to fix their input — returned rather than thrown so a
 * production build doesn't strip it (see actionResult.ts).
 */
export async function savePricingRulesAction(
  rules: WindowCleaningPricingRules,
): Promise<ActionResult<PricingConfiguration>> {
  const { db, session } = await requireContext();
  try {
    const configuration = await saveNewPricingConfigurationVersion(db, session, rules);
    revalidatePath("/dashboard/pricing");
    return { ok: true, data: configuration };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Could not save pricing rules." };
  }
}
