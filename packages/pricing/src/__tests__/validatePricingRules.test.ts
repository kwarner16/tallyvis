import { describe, expect, it } from "vitest";
import type { WindowCleaningPricingRules } from "@tallyvis/types";
import { validatePricingRules } from "../validatePricingRules";

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

describe("validatePricingRules", () => {
  it("accepts a well-formed rate card", () => {
    const result = validatePricingRules(validRules);
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("accepts zero as a valid price (a business may legitimately not charge for something)", () => {
    const result = validatePricingRules({ ...validRules, pricePerPane: 0, travelFee: 0 });
    expect(result.valid).toBe(true);
  });

  it("flags a negative price field with a specific message", () => {
    const result = validatePricingRules({ ...validRules, basePrice: -10 });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Base price cannot be negative.");
  });

  it("flags a non-numeric price field", () => {
    const result = validatePricingRules({
      ...validRules,
      pricePerWindow: Number.NaN,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Price per window must be a number.");
  });

  it("flags a non-finite price field", () => {
    const result = validatePricingRules({ ...validRules, minimumJobPrice: Infinity });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Minimum job price must be a number.");
  });

  it("collects every invalid price field, not just the first", () => {
    const result = validatePricingRules({
      ...validRules,
      basePrice: -1,
      pricePerWindow: -1,
      travelFee: -1,
    });
    expect(result.errors).toHaveLength(3);
  });

  it("flags a difficulty multiplier that is zero or negative", () => {
    const result = validatePricingRules({
      ...validRules,
      difficultyMultipliers: { ...validRules.difficultyMultipliers, easy: 0 },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Easy difficulty multiplier must be greater than zero.");
  });

  it("flags a non-numeric difficulty multiplier", () => {
    const result = validatePricingRules({
      ...validRules,
      difficultyMultipliers: { ...validRules.difficultyMultipliers, difficult: Number.NaN },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Difficult difficulty multiplier must be a number.");
  });

  it("flags missing difficulty multipliers", () => {
    const result = validatePricingRules({
      ...validRules,
      difficultyMultipliers: undefined as unknown as WindowCleaningPricingRules["difficultyMultipliers"],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Difficulty multipliers are missing.");
  });

  it("flags an unsupported vertical", () => {
    const result = validatePricingRules({
      ...validRules,
      vertical: "pressure-washing" as WindowCleaningPricingRules["vertical"],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Unsupported vertical: "pressure-washing"');
  });
});
