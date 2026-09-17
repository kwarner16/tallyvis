import { describe, expect, it } from "vitest";
import type {
  PricingConfiguration,
  WindowCleaningCharacteristics,
  WindowCleaningPricingRules,
} from "@tallyvis/types";
import { calculateEstimate } from "../calculateEstimate";
import { calculateWindowCleaningEstimate } from "../windowCleaning";

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

const characteristics: WindowCleaningCharacteristics = {
  vertical: "window-cleaning",
  windowCount: 20,
  windowType: "double-hung",
  paneCount: 0,
  stories: 1,
  screens: 0,
  tracks: 0,
  accessibility: "easy",
  condition: "good",
  hardWaterStaining: false,
  estimatedLaborHours: 2,
  interiorCleaning: false,
};

describe("calculateEstimate", () => {
  it("produces the same result as calling the vertical function directly with the configuration's rules", () => {
    const viaCanonicalEntryPoint = calculateEstimate(characteristics, validConfiguration, "high");
    const viaVerticalFunction = calculateWindowCleaningEstimate(
      characteristics,
      validConfiguration.rules,
      "high",
    );
    expect(viaCanonicalEntryPoint).toEqual(viaVerticalFunction);
  });

  it("defaults confidence to high when not provided", () => {
    const estimate = calculateEstimate(characteristics, validConfiguration);
    expect(estimate.confidence).toBe("high");
  });

  it("throws with every validation error when the configuration is invalid", () => {
    const invalidConfiguration: PricingConfiguration = {
      ...validConfiguration,
      id: "",
      version: 0,
      rules: { ...validRules, basePrice: -1 },
    };

    expect(() => calculateEstimate(characteristics, invalidConfiguration)).toThrow(
      /missing an id.*positive integer.*negative/s,
    );
  });

  it("throws when the characteristics' vertical does not match the configuration's industry", () => {
    const mismatchedCharacteristics = {
      ...characteristics,
      vertical: "pressure-washing",
    } as unknown as WindowCleaningCharacteristics;

    expect(() => calculateEstimate(mismatchedCharacteristics, validConfiguration)).toThrow(
      /does not match characteristics vertical/,
    );
  });

  it("does not mutate the configuration or characteristics it is given", () => {
    const configurationSnapshot = JSON.parse(JSON.stringify(validConfiguration));
    const characteristicsSnapshot = JSON.parse(JSON.stringify(characteristics));

    calculateEstimate(characteristics, validConfiguration, "medium");

    expect(validConfiguration).toEqual(configurationSnapshot);
    expect(characteristics).toEqual(characteristicsSnapshot);
  });
});
