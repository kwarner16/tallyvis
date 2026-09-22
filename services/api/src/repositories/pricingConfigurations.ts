import type { PricingConfiguration, PricingRules } from "@tallyvis/types";
import { makeId } from "../db/ids";
import type { Queryable } from "../db/pg/client";

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
export async function getActivePricingConfiguration(
  db: Queryable,
  businessId: string,
): Promise<PricingConfiguration | undefined> {
  const result = await db.query<PricingConfigurationRow>(
    `SELECT * FROM pricing_configurations WHERE business_id = $1 ORDER BY version DESC LIMIT 1`,
    [businessId],
  );
  const row = result.rows[0];
  return row ? toPricingConfiguration(row) : undefined;
}

/** Looks up a specific (possibly historical) version by id — how a quote's pinned `pricingConfigId` is resolved back to the rate card that priced it. */
export async function getPricingConfigurationById(
  db: Queryable,
  businessId: string,
  id: string,
): Promise<PricingConfiguration | undefined> {
  const result = await db.query<PricingConfigurationRow>(
    `SELECT * FROM pricing_configurations WHERE id = $1 AND business_id = $2`,
    [id, businessId],
  );
  const row = result.rows[0];
  return row ? toPricingConfiguration(row) : undefined;
}

/** Seeds the very first pricing configuration (version 1) for a newly created business — never called again after that; every later save goes through `createNextPricingConfigurationVersion`. */
export async function createInitialPricingConfiguration(
  db: Queryable,
  businessId: string,
  rules: PricingRules,
  currency = "USD",
): Promise<PricingConfiguration> {
  const id = makeId("pricing-config");
  const effectiveAt = new Date().toISOString();
  await db.query(
    `INSERT INTO pricing_configurations (id, business_id, industry, currency, version, effective_at, rules_json)
     VALUES ($1, $2, $3, $4, 1, $5, $6)`,
    [id, businessId, rules.vertical, currency, effectiveAt, JSON.stringify(rules)],
  );
  return { id, businessId, industry: rules.vertical, currency, version: 1, effectiveAt, rules };
}

/**
 * Appends a new version rather than mutating the current one — see
 * docs/decisions/0009-pricing-configuration-versioning.md. Quotes already
 * priced under an earlier version keep referencing it by id; this never
 * touches an existing row.
 */
export async function createNextPricingConfigurationVersion(
  db: Queryable,
  businessId: string,
  rules: PricingRules,
): Promise<PricingConfiguration> {
  const current = await getActivePricingConfiguration(db, businessId);
  if (!current) throw new Error(`Business "${businessId}" has no pricing configuration to version from.`);

  const id = makeId("pricing-config");
  const version = current.version + 1;
  const effectiveAt = new Date().toISOString();
  await db.query(
    `INSERT INTO pricing_configurations (id, business_id, industry, currency, version, effective_at, rules_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, businessId, rules.vertical, current.currency, version, effectiveAt, JSON.stringify(rules)],
  );

  return { id, businessId, industry: rules.vertical, currency: current.currency, version, effectiveAt, rules };
}
