import { describe, expect, it } from "vitest";
import type { PricingConfiguration, WindowCleaningPricingRules } from "@tallyvis/types";
import { validatePricingConfiguration } from "../validatePricingConfiguration";

const validRules: WindowCleaningPricingRules = {
  vertical: "window-cleaning",
  basePrice: 125,
  pricePerWindow: 8,
  pricePerPane: 0,
  secondStorySurcharge: 35,
  screenCleaningPrice: 3,
  trackCleaningPrice: 4,
  hardWaterTreatmentPrice: 60,
  interiorCleaningPrice: 45,
  minimumJobPrice: 175,
  travelFee: 25,
  difficultyMultipliers: { easy: 1, moderate: 1.15, difficult: 1.35 },
};

const validConfiguration: PricingConfiguration = {
  id: "demo-window-cleaning-co-pricing-v1",
  businessId: "demo-window-cleaning-co",
  industry: "window-cleaning",
  currency: "USD",
  version: 1,
  effectiveAt: "2025-01-01T00:00:00.000Z",
  rules: validRules,
};

describe("validatePricingConfiguration", () => {
  it("accepts a well-formed configuration", () => {
    expect(validatePricingConfiguration(validConfiguration)).toEqual({ valid: true, errors: [] });
  });

  it("flags a missing id", () => {
    const result = validatePricingConfiguration({ ...validConfiguration, id: "" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Pricing configuration is missing an id.");
  });

  it("flags a missing businessId", () => {
    const result = validatePricingConfiguration({ ...validConfiguration, businessId: "" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Pricing configuration is missing a businessId.");
  });

  it("flags a missing currency", () => {
    const result = validatePricingConfiguration({ ...validConfiguration, currency: "" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Pricing configuration is missing a currency.");
  });

  it("flags a non-positive version", () => {
    const result = validatePricingConfiguration({ ...validConfiguration, version: 0 });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Pricing configuration version must be a positive integer.");
  });

  it("flags a non-integer version", () => {
    const result = validatePricingConfiguration({ ...validConfiguration, version: 1.5 });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Pricing configuration version must be a positive integer.");
  });

  it("flags an unparseable effectiveAt date", () => {
    const result = validatePricingConfiguration({
      ...validConfiguration,
      effectiveAt: "not-a-date",
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Pricing configuration effectiveAt must be a valid date.");
  });

  it("flags a missing effectiveAt", () => {
    const result = validatePricingConfiguration({ ...validConfiguration, effectiveAt: "" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Pricing configuration effectiveAt must be a valid date.");
  });

  it("flags missing rules", () => {
    const result = validatePricingConfiguration({
      ...validConfiguration,
      rules: undefined as unknown as WindowCleaningPricingRules,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Pricing configuration is missing rules.");
  });

  it("delegates rate-card problems to validatePricingRules and surfaces them alongside envelope errors", () => {
    const result = validatePricingConfiguration({
      ...validConfiguration,
      id: "",
      rules: { ...validRules, basePrice: -1 },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Pricing configuration is missing an id.");
    expect(result.errors).toContain("Base price cannot be negative.");
  });

  it("flags an unsupported industry on the envelope even when rules look window-cleaning-shaped", () => {
    const result = validatePricingConfiguration({
      ...validConfiguration,
      industry: "pressure-washing" as PricingConfiguration["industry"],
      rules: { ...validRules, vertical: "pressure-washing" as WindowCleaningPricingRules["vertical"] },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Unsupported pricing configuration industry: "pressure-washing"');
  });
});
