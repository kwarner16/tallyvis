import { describe, expect, it } from "vitest";
import { reconcileObservation } from "../reconcile";
import type { RawPropertyObservation } from "../types";

/**
 * `reconcileObservation` is the boundary between "what the AI observed"
 * and `WindowCleaningCharacteristics` — the exact shape
 * `calculateEstimate()` already accepted before Phase 11 existed. These
 * tests verify uncertainty is resolved into sensible, reviewable defaults
 * (never silently invented), and — the actual pricing-boundary contract —
 * that nothing here ever produces a dollar amount.
 */

const metadata = { vertical: "window-cleaning" as const };

function fullyObserved(overrides: Partial<RawPropertyObservation> = {}): RawPropertyObservation {
  return {
    vertical: "window-cleaning",
    propertyType: { status: "observed", value: "single-family", confidence: "high" },
    stories: { status: "observed", value: 2, confidence: "high" },
    windowCount: { status: "observed", value: 24, confidence: "high" },
    windowType: { status: "observed", value: "casement", confidence: "high" },
    screens: { status: "observed", value: 12, confidence: "high" },
    tracks: { status: "observed", value: 12, confidence: "high" },
    accessibility: { status: "observed", value: "difficult", confidence: "high" },
    condition: { status: "observed", value: "fair", confidence: "high" },
    hardWaterStaining: { status: "observed", value: true, confidence: "high" },
    overallConfidence: "high",
    warnings: [],
    ...overrides,
  };
}

describe("reconcileObservation — observed values pass through", () => {
  it("uses every observed value as-is when the AI is confident about everything", () => {
    const result = reconcileObservation(fullyObserved(), metadata);
    expect(result.characteristics).toMatchObject({
      vertical: "window-cleaning",
      stories: 2,
      windowCount: 24,
      windowType: "casement",
      screens: 12,
      tracks: 12,
      accessibility: "difficult",
      condition: "fair",
      hardWaterStaining: true,
    });
    expect(result.metadata.confidence).toBe("high");
  });

  it("computes estimatedLaborHours deterministically — never asks the AI for it directly", () => {
    const result = reconcileObservation(fullyObserved(), metadata);
    expect(typeof result.characteristics.estimatedLaborHours).toBe("number");
    expect(result.characteristics.estimatedLaborHours).toBeGreaterThan(0);
  });

  it("never produces a dollar amount, price, rate, or multiplier of any kind", () => {
    const result = reconcileObservation(fullyObserved(), metadata);
    const serialized = JSON.stringify(result);
    for (const forbidden of ["price", "Price", "total", "Total", "rate", "Rate", "multiplier", "Multiplier", "$"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe("reconcileObservation — uncertainty falls back honestly, never invents", () => {
  it("falls back stories to the customer-declared value when unknown", () => {
    const observation = fullyObserved({ stories: { status: "unknown" } });
    const result = reconcileObservation(observation, { ...metadata, customerDeclaredStories: 3 });
    expect(result.characteristics.stories).toBe(3);
    expect(result.metadata.notes?.some((n) => n.toLowerCase().includes("stories"))).toBe(true);
  });

  it("falls back stories to 1 when neither observed nor customer-declared", () => {
    const observation = fullyObserved({ stories: { status: "unknown" } });
    const result = reconcileObservation(observation, metadata);
    expect(result.characteristics.stories).toBe(1);
  });

  it("falls back windowCount to a stories-based heuristic when uncertain", () => {
    const observation = fullyObserved({
      stories: { status: "observed", value: 2, confidence: "high" },
      windowCount: { status: "uncertain", confidence: "low" },
    });
    const result = reconcileObservation(observation, metadata);
    expect(result.characteristics.windowCount).toBeGreaterThanOrEqual(4);
    expect(result.characteristics.windowCount).toBeLessThanOrEqual(40);
  });

  it("falls back hardWaterStaining to false when unknown, never true", () => {
    const observation = fullyObserved({ hardWaterStaining: { status: "unknown" } });
    const result = reconcileObservation(observation, metadata);
    expect(result.characteristics.hardWaterStaining).toBe(false);
  });

  it("derives accessibility from stories when accessibility itself is unknown", () => {
    const observation = fullyObserved({
      stories: { status: "observed", value: 1, confidence: "high" },
      accessibility: { status: "unknown" },
    });
    const result = reconcileObservation(observation, metadata);
    expect(result.characteristics.accessibility).toBe("easy");
  });

  it("records every fallback used as a reviewable note, distinct from provider warnings", () => {
    const observation = fullyObserved({
      windowCount: { status: "unknown" },
      condition: { status: "uncertain", confidence: "low" },
      warnings: ["Rear of the property not visible."],
    });
    const result = reconcileObservation(observation, metadata);
    expect(result.metadata.notes).toContain("Rear of the property not visible.");
    expect(result.metadata.notes?.some((n) => n.includes("Window count"))).toBe(true);
    expect(result.metadata.notes?.some((n) => n.includes("Condition"))).toBe(true);
  });

  it("has no notes at all when nothing needed a fallback and no warnings were raised", () => {
    const result = reconcileObservation(fullyObserved(), metadata);
    expect(result.metadata.notes).toBeUndefined();
  });
});

describe("reconcileObservation — confidence is downgraded, not just copied", () => {
  it("downgrades to low when two or more important fields are not observed, regardless of the AI's own claim", () => {
    const observation = fullyObserved({
      overallConfidence: "high",
      stories: { status: "uncertain", confidence: "medium" },
      windowCount: { status: "unknown" },
    });
    const result = reconcileObservation(observation, metadata);
    expect(result.metadata.confidence).toBe("low");
  });

  it("downgrades high to medium when exactly one important field is not observed", () => {
    const observation = fullyObserved({
      overallConfidence: "high",
      accessibility: { status: "uncertain", confidence: "medium" },
    });
    const result = reconcileObservation(observation, metadata);
    expect(result.metadata.confidence).toBe("medium");
  });

  it("does not upgrade a low claim just because the important fields happen to be observed", () => {
    const observation = fullyObserved({ overallConfidence: "low" });
    const result = reconcileObservation(observation, metadata);
    expect(result.metadata.confidence).toBe("low");
  });
});
