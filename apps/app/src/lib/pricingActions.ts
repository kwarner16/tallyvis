"use server";

import { revalidatePath } from "next/cache";
import type { PricingConfiguration, WindowCleaningPricingRules } from "@tallyvis/types";
import { saveNewPricingConfigurationVersion } from "@tallyvis/api";
import { requireContext } from "./session";

export async function savePricingRulesAction(
  rules: WindowCleaningPricingRules,
): Promise<PricingConfiguration> {
  const { db, session } = await requireContext();
  const configuration = await saveNewPricingConfigurationVersion(db, session, rules);
  revalidatePath("/dashboard/pricing");
  return configuration;
}
