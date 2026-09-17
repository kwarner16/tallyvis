import { describe, expect, it } from "vitest";
import type { WindowCleaningCharacteristics, WindowCleaningPricingRules } from "@tallyvis/types";
import { calculateWindowCleaningEstimate } from "../windowCleaning";

const baseRules: WindowCleaningPricingRules = {
  vertical: "window-cleaning",
  basePrice: 50,
  pricePerWindow: 8,
  pricePerPane: 0,
  secondStorySurcharge: 40,
  screenCleaningPrice: 3,
  trackCleaningPrice: 2,
  hardWaterTreatmentPrice: 60,
  interiorCleaningPrice: 45,
  minimumJobPrice: 150,
  travelFee: 25,
  difficultyMultipliers: { easy: 1, moderate: 1.15, difficult: 1.35 },
};

const baseCharacteristics: WindowCleaningCharacteristics = {
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

describe("calculateWindowCleaningEstimate", () => {
  it("calculates a simple single-story job", () => {
    const estimate = calculateWindowCleaningEstimate(baseCharacteristics, baseRules);

    // base (50) + windows (20 * 8 = 160) + travel (25) = 235
    expect(estimate.total).toBe(235);
    expect(estimate.currency).toBe("USD");
    expect(estimate.confidence).toBe("high");
  });

  it("applies the second-story surcharge", () => {
    const estimate = calculateWindowCleaningEstimate(
      { ...baseCharacteristics, stories: 2 },
      baseRules,
    );

    // previous 235 - 25 travel = 210 labor, +40 surcharge = 250, + travel 25 = 275
    expect(estimate.total).toBe(275);
  });

  it("applies the difficulty multiplier to labor but not to the travel fee", () => {
    const estimate = calculateWindowCleaningEstimate(
      { ...baseCharacteristics, accessibility: "moderate" },
      baseRules,
    );

    // labor subtotal 210 * 1.15 = 241.5, + travel 25 = 266.5
    expect(estimate.total).toBe(266.5);
  });

  it("enforces the minimum job price", () => {
    const estimate = calculateWindowCleaningEstimate(
      { ...baseCharacteristics, windowCount: 2 },
      baseRules,
    );

    // base (50) + windows (16) + travel (25) = 91, below the $150 minimum
    expect(estimate.total).toBe(150);
    expect(estimate.lineItems.some((item) => item.label.includes("Minimum job price"))).toBe(true);
  });

  it("adds hard-water treatment, screens, and tracks as separate line items", () => {
    const estimate = calculateWindowCleaningEstimate(
      { ...baseCharacteristics, screens: 10, tracks: 10, hardWaterStaining: true },
      baseRules,
    );

    expect(estimate.lineItems.some((item) => item.label.startsWith("Screen cleaning"))).toBe(true);
    expect(estimate.lineItems.some((item) => item.label.startsWith("Track cleaning"))).toBe(true);
    expect(estimate.lineItems.some((item) => item.label === "Hard-water treatment")).toBe(true);
  });

  it("adds interior cleaning as its own line item only when requested", () => {
    const withInterior = calculateWindowCleaningEstimate(
      { ...baseCharacteristics, interiorCleaning: true },
      baseRules,
    );
    const withoutInterior = calculateWindowCleaningEstimate(baseCharacteristics, baseRules);

    expect(withInterior.lineItems.some((item) => item.label === "Interior cleaning")).toBe(true);
    expect(withoutInterior.lineItems.some((item) => item.label === "Interior cleaning")).toBe(
      false,
    );
    expect(withInterior.total).toBe(withoutInterior.total + baseRules.interiorCleaningPrice);
  });
});
