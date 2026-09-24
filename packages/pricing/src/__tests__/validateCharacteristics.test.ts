import { describe, expect, it } from "vitest";
import type { WindowCleaningCharacteristics } from "@tallyvis/types";
import { validateCharacteristics } from "../validateCharacteristics";

/**
 * Vision V1.1 (docs/decisions/0023-guided-capture-evidence-confidence.md)
 * — a customer's own edits in the public estimator's confirmation step now
 * reach `calculateEstimate` as `characteristics`, crossing a Server Action
 * boundary with no compile-time guarantee the JSON actually matches
 * `WindowCleaningCharacteristics`. This validator is the defense-in-depth
 * check that runs before any of that reaches pricing math.
 */

function validCharacteristics(): WindowCleaningCharacteristics {
  return {
    vertical: "window-cleaning",
    windowCount: 20,
    windowType: "double-hung",
    paneCount: 0,
    stories: 2,
    screens: 10,
    tracks: 10,
    accessibility: "moderate",
    condition: "good",
    hardWaterStaining: false,
    estimatedLaborHours: 3,
    interiorCleaning: false,
  };
}

describe("validateCharacteristics — accepts sane values", () => {
  it("accepts fully valid characteristics", () => {
    expect(validateCharacteristics(validCharacteristics())).toEqual({ valid: true, errors: [] });
  });

  it("accepts the extremes of every allowed range", () => {
    const extremes: WindowCleaningCharacteristics = {
      ...validCharacteristics(),
      windowCount: 300,
      stories: 6,
      screens: 0,
      tracks: 300,
      paneCount: 0,
      estimatedLaborHours: 200,
    };
    expect(validateCharacteristics(extremes).valid).toBe(true);
  });
});

describe("validateCharacteristics — rejects an absurd or malformed value rather than pricing it", () => {
  it("rejects a windowCount outside the sane range", () => {
    const result = validateCharacteristics({ ...validCharacteristics(), windowCount: 50000 });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/windowCount/);
  });

  it("rejects a negative windowCount", () => {
    expect(validateCharacteristics({ ...validCharacteristics(), windowCount: -5 }).valid).toBe(false);
  });

  it("rejects a non-integer windowCount", () => {
    expect(validateCharacteristics({ ...validCharacteristics(), windowCount: 20.5 }).valid).toBe(false);
  });

  it("rejects an invalid accessibility enum value", () => {
    const result = validateCharacteristics({
      ...validCharacteristics(),
      accessibility: "impossible" as WindowCleaningCharacteristics["accessibility"],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/accessibility/);
  });

  it("rejects a stories value outside the sane range", () => {
    expect(validateCharacteristics({ ...validCharacteristics(), stories: 50 }).valid).toBe(false);
  });

  it("rejects a non-boolean hardWaterStaining", () => {
    const result = validateCharacteristics({
      ...validCharacteristics(),
      hardWaterStaining: "yes" as unknown as boolean,
    });
    expect(result.valid).toBe(false);
  });

  it("rejects an unsupported vertical", () => {
    const result = validateCharacteristics({
      ...validCharacteristics(),
      vertical: "pressure-washing" as unknown as "window-cleaning",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/vertical/i);
  });

  it("accumulates every error in one pass rather than stopping at the first", () => {
    const result = validateCharacteristics({
      ...validCharacteristics(),
      windowCount: -1,
      stories: 500,
      accessibility: "bad" as unknown as WindowCleaningCharacteristics["accessibility"],
    });
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("validateCharacteristics — wired into calculateEstimate", () => {
  it("calculateEstimate throws rather than pricing an absurd customer-supplied windowCount", async () => {
    const { calculateEstimate } = await import("../calculateEstimate");
    const rules = {
      vertical: "window-cleaning" as const,
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
    const configuration = {
      id: "test-config",
      businessId: "test-business",
      industry: "window-cleaning" as const,
      currency: "USD",
      version: 1,
      effectiveAt: "2025-01-01T00:00:00.000Z",
      rules,
    };

    expect(() =>
      calculateEstimate({ ...validCharacteristics(), windowCount: 999999 }, configuration),
    ).toThrow(/invalid characteristics/i);
  });
});
