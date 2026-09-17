import type { DatabaseSync } from "node:sqlite";
import type { PricingConfiguration, PricingRules } from "@tallyvis/types";
import { makeId } from "../db/ids";

interface PricingConfigurationRow {
  id: string;
  business_id: string;
  industry: string;
  currency: string;
  version: number;
  effective_at: string;
  rules_json: string;
}

function toPricingConfiguration(row: PricingConfigurationRow): PricingConfiguration {
  return {
    id: row.id,
    businessId: row.business_id,
    industry: row.industry as PricingConfiguration["industry"],
    currency: row.currency,
    version: row.version,
    effectiveAt: row.effective_at,
    rules: JSON.parse(row.rules_json) as PricingRules,
  };
}

/** The active configuration is the highest version this business has saved — same rule the Phase 6/7 mock store used. */
export function getActivePricingConfiguration(
  db: DatabaseSync,
  businessId: string,
): PricingConfiguration | undefined {
  const row = db
    .prepare(
      `SELECT * FROM pricing_configurations WHERE business_id = ? ORDER BY version DESC LIMIT 1`,
    )
    .get(businessId) as PricingConfigurationRow | undefined;
  return row ? toPricingConfiguration(row) : undefined;
}

/** Looks up a specific (possibly historical) version by id — how a quote's pinned `pricingConfigId` is resolved back to the rate card that priced it. */
export function getPricingConfigurationById(
  db: DatabaseSync,
  businessId: string,
  id: string,
): PricingConfiguration | undefined {
  const row = db
    .prepare(`SELECT * FROM pricing_configurations WHERE id = ? AND business_id = ?`)
    .get(id, businessId) as PricingConfigurationRow | undefined;
  return row ? toPricingConfiguration(row) : undefined;
}

/** Seeds the very first pricing configuration (version 1) for a newly created business — never called again after that; every later save goes through `createNextPricingConfigurationVersion`. */
export function createInitialPricingConfiguration(
  db: DatabaseSync,
  businessId: string,
  rules: PricingRules,
  currency = "USD",
): PricingConfiguration {
  const id = makeId("pricing-config");
  const effectiveAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO pricing_configurations (id, business_id, industry, currency, version, effective_at, rules_json)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
  ).run(id, businessId, rules.vertical, currency, effectiveAt, JSON.stringify(rules));
  return { id, businessId, industry: rules.vertical, currency, version: 1, effectiveAt, rules };
}

/**
 * Appends a new version rather than mutating the current one — see
 * docs/decisions/0009-pricing-configuration-versioning.md. Quotes already
 * priced under an earlier version keep referencing it by id; this never
 * touches an existing row.
 */
export function createNextPricingConfigurationVersion(
  db: DatabaseSync,
  businessId: string,
  rules: PricingRules,
): PricingConfiguration {
  const current = getActivePricingConfiguration(db, businessId);
  if (!current) throw new Error(`Business "${businessId}" has no pricing configuration to version from.`);

  const id = makeId("pricing-config");
  const version = current.version + 1;
  const effectiveAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO pricing_configurations (id, business_id, industry, currency, version, effective_at, rules_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, businessId, rules.vertical, current.currency, version, effectiveAt, JSON.stringify(rules));

  return { id, businessId, industry: rules.vertical, currency: current.currency, version, effectiveAt, rules };
}
