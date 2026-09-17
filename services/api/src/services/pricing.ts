import type { DatabaseSync } from "node:sqlite";
import type { PricingConfiguration, WindowCleaningPricingRules } from "@tallyvis/types";
import { validatePricingRules } from "@tallyvis/pricing";
import type { AuthSession } from "../auth/session";
import {
  createNextPricingConfigurationVersion,
  getActivePricingConfiguration,
  getPricingConfigurationById as getPricingConfigurationByIdRepo,
} from "../repositories/pricingConfigurations";

/** Every function here takes an `AuthSession`, not a bare businessId — the business a caller can affect is exactly the one their session says they belong to. */

export function getActiveConfiguration(db: DatabaseSync, session: AuthSession): PricingConfiguration {
  const configuration = getActivePricingConfiguration(db, session.businessId);
  if (!configuration) {
    throw new Error(`Business "${session.businessId}" has no pricing configuration.`);
  }
  return configuration;
}

/** Public counterpart to `getActiveConfiguration` for the unauthenticated `/estimate/*` wizard — see `services/quotes.ts`'s `createQuotePublic`. */
export function getActiveConfigurationForBusiness(
  db: DatabaseSync,
  businessId: string,
): PricingConfiguration {
  const configuration = getActivePricingConfiguration(db, businessId);
  if (!configuration) {
    throw new Error(`Business "${businessId}" has no pricing configuration.`);
  }
  return configuration;
}

export function getConfigurationById(
  db: DatabaseSync,
  session: AuthSession,
  id: string,
): PricingConfiguration | undefined {
  return getPricingConfigurationByIdRepo(db, session.businessId, id);
}

/**
 * Validates through the pricing package's authoritative `validatePricingRules`
 * — same as the Phase 7 dashboard save flow — before creating a new version.
 * Never mutates the current one in place; see
 * docs/decisions/0009-pricing-configuration-versioning.md.
 */
export function saveNewPricingConfigurationVersion(
  db: DatabaseSync,
  session: AuthSession,
  rules: WindowCleaningPricingRules,
): PricingConfiguration {
  const validation = validatePricingRules(rules);
  if (!validation.valid) {
    throw new Error(`Cannot save invalid pricing rules: ${validation.errors.join(" ")}`);
  }
  return createNextPricingConfigurationVersion(db, session.businessId, rules);
}
