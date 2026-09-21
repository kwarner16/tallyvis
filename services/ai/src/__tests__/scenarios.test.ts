import { describe, expect, it } from "vitest";
import { validateRawPropertyObservation } from "../validateObservation";
import { reconcileObservation } from "../reconcile";
import type { RawPropertyObservation } from "../types";

/**
 * Phase 12 (docs/decisions/0014-ai-real-world-refinement.md) — a small,
 * dev-only synthetic test dataset covering the realistic scenarios the
 * brief calls out by name. There is no real API key in this environment,
 * so these are hand-authored MOCKED vision outputs (what a real provider's
 * `report_property_observation` tool call would plausibly look like for
 * each scenario), not real photos and not accuracy claims — each test
 * verifies the *pipeline's* behavior (validation accepts/rejects it
 * correctly, reconciliation produces sensible, reviewable
 * characteristics), never a claim about how a real model would actually
 * perform on a real photo of that kind of property.
 */

const metadata = { vertical: "window-cleaning" as const };

describe("synthetic scenario: simple single-story property, fully visible", () => {
  const observation: RawPropertyObservation = {
    vertical: "window-cleaning",
    stories: { status: "observed", value: 1, confidence: "high" },
    windowCount: { status: "observed", value: 8, confidence: "high" },
    windowType: { status: "observed", value: "single-hung", confidence: "high" },
    screens: { status: "observed", value: 8, confidence: "high" },
    tracks: { status: "observed", value: 8, confidence: "high" },
    accessibility: { status: "observed", value: "easy", confidence: "high" },
    condition: { status: "observed", value: "good", confidence: "high" },
    hardWaterStaining: { status: "observed", value: false, confidence: "high" },
    overallConfidence: "high",
    warnings: [],
  };

  it("validates and reconciles with high confidence and no fallback notes", () => {
    const validated = validateRawPropertyObservation(observation);
    expect(validated.ok).toBe(true);
    const result = reconcileObservation(observation, metadata);
    expect(result.characteristics.stories).toBe(1);
    expect(result.characteristics.accessibility).toBe("easy");
    expect(result.metadata.confidence).toBe("high");
    expect(result.metadata.notes).toBeUndefined();
  });
});

describe("synthetic scenario: two-story property with a mix of large and small windows", () => {
  const observation: RawPropertyObservation = {
    vertical: "window-cleaning",
    stories: { status: "observed", value: 2, confidence: "high" },
    // A real model asked only for a count can't report per-window size —
    // a mixed-size property is exactly the kind of thing that should
    // lower its confidence in the count rather than making one up.
    windowCount: { status: "uncertain", confidence: "medium" },
    windowType: { status: "uncertain", confidence: "low" },
    screens: { status: "observed", value: 14, confidence: "medium" },
    tracks: { status: "observed", value: 14, confidence: "medium" },
    accessibility: { status: "observed", value: "moderate", confidence: "medium" },
    condition: { status: "observed", value: "good", confidence: "medium" },
    hardWaterStaining: { status: "observed", value: false, confidence: "medium" },
    overallConfidence: "medium",
    warnings: ["Window sizes vary significantly across the front elevation; count is an estimate."],
  };

  it("falls back windowCount to a stories-based heuristic and preserves the provider's warning", () => {
    const validated = validateRawPropertyObservation(observation);
    expect(validated.ok).toBe(true);
    const result = reconcileObservation(observation, metadata);
    expect(result.characteristics.windowCount).toBeGreaterThan(0);
    expect(result.metadata.notes).toContain(
      "Window sizes vary significantly across the front elevation; count is an estimate.",
    );
  });
});

describe("synthetic scenario: difficult access — third story, locked gate", () => {
  const observation: RawPropertyObservation = {
    vertical: "window-cleaning",
    stories: { status: "observed", value: 3, confidence: "high" },
    windowCount: { status: "observed", value: 30, confidence: "medium" },
    windowType: { status: "observed", value: "casement", confidence: "medium" },
    screens: { status: "observed", value: 20, confidence: "medium" },
    tracks: { status: "observed", value: 20, confidence: "medium" },
    accessibility: { status: "observed", value: "difficult", confidence: "high" },
    condition: { status: "observed", value: "fair", confidence: "medium" },
    hardWaterStaining: { status: "observed", value: true, confidence: "medium" },
    overallConfidence: "medium",
    warnings: ["Locked side gate blocks access to the rear windows."],
  };

  it("passes the difficult accessibility rating through, not just an inferred one", () => {
    const result = reconcileObservation(observation, metadata);
    expect(result.characteristics.accessibility).toBe("difficult");
    expect(result.metadata.notes).toContain("Locked side gate blocks access to the rear windows.");
  });
});

describe("synthetic scenario: partial obstruction — landscaping blocks part of the facade", () => {
  const observation: RawPropertyObservation = {
    vertical: "window-cleaning",
    stories: { status: "observed", value: 2, confidence: "medium" },
    windowCount: { status: "uncertain", confidence: "low" },
    windowType: { status: "observed", value: "double-hung", confidence: "medium" },
    screens: { status: "uncertain", confidence: "low" },
    tracks: { status: "uncertain", confidence: "low" },
    accessibility: { status: "observed", value: "moderate", confidence: "medium" },
    condition: { status: "unknown" },
    hardWaterStaining: { status: "unknown" },
    overallConfidence: "low",
    warnings: ["Dense landscaping obscures the lower windows on the left side of the house."],
  };

  it("honestly reports low confidence rather than guessing past what's visible", () => {
    const validated = validateRawPropertyObservation(observation);
    expect(validated.ok).toBe(true);
    const result = reconcileObservation(observation, metadata);
    expect(result.metadata.confidence).toBe("low");
    expect(result.characteristics.hardWaterStaining).toBe(false);
  });
});

describe("synthetic scenario: multiple visible sides of the property across several photos", () => {
  const observation: RawPropertyObservation = {
    vertical: "window-cleaning",
    stories: { status: "observed", value: 2, confidence: "high" },
    windowCount: { status: "observed", value: 26, confidence: "high" },
    windowType: { status: "observed", value: "double-hung", confidence: "high" },
    screens: { status: "observed", value: 22, confidence: "high" },
    tracks: { status: "observed", value: 22, confidence: "high" },
    accessibility: { status: "observed", value: "moderate", confidence: "high" },
    condition: { status: "observed", value: "good", confidence: "high" },
    hardWaterStaining: { status: "observed", value: false, confidence: "high" },
    overallConfidence: "high",
    warnings: [],
  };

  it("reflects the higher confidence multiple angles should support", () => {
    const result = reconcileObservation(observation, metadata);
    expect(result.metadata.confidence).toBe("high");
    expect(result.characteristics.windowCount).toBe(26);
  });
});

describe("synthetic scenario: low-quality or ambiguous single photo", () => {
  const observation: RawPropertyObservation = {
    vertical: "window-cleaning",
    stories: { status: "uncertain", confidence: "low" },
    windowCount: { status: "unknown" },
    windowType: { status: "unknown" },
    screens: { status: "unknown" },
    tracks: { status: "unknown" },
    accessibility: { status: "unknown" },
    condition: { status: "unknown" },
    hardWaterStaining: { status: "unknown" },
    overallConfidence: "low",
    warnings: ["Photo is blurry and taken from too far away to make out window details."],
  };

  it("never invents specifics from an unusable photo — everything falls back to documented defaults", () => {
    const validated = validateRawPropertyObservation(observation);
    expect(validated.ok).toBe(true);
    const result = reconcileObservation(observation, metadata);
    expect(result.characteristics.stories).toBe(1);
    expect(result.characteristics.hardWaterStaining).toBe(false);
    expect(result.metadata.confidence).toBe("low");
    expect(result.metadata.notes).toContain(
      "Photo is blurry and taken from too far away to make out window details.",
    );
  });
});

describe("synthetic scenario: customer-declared story count fills a genuine gap", () => {
  const observation: RawPropertyObservation = {
    vertical: "window-cleaning",
    stories: { status: "unknown" },
    windowCount: { status: "uncertain", confidence: "low" },
    windowType: { status: "unknown" },
    screens: { status: "unknown" },
    tracks: { status: "unknown" },
    accessibility: { status: "unknown" },
    condition: { status: "unknown" },
    hardWaterStaining: { status: "unknown" },
    overallConfidence: "low",
    warnings: ["No photos show the full height of the property."],
  };

  it("uses the customer-declared story count as the fallback, not a guess", () => {
    const result = reconcileObservation(observation, { ...metadata, customerDeclaredStories: 2 });
    expect(result.characteristics.stories).toBe(2);
  });
});

describe("synthetic scenario: several photos of the same angle add no new information", () => {
  const observation: RawPropertyObservation = {
    vertical: "window-cleaning",
    stories: { status: "observed", value: 1, confidence: "medium" },
    windowCount: { status: "observed", value: 10, confidence: "medium" },
    windowType: { status: "observed", value: "sliding", confidence: "medium" },
    screens: { status: "observed", value: 6, confidence: "medium" },
    tracks: { status: "observed", value: 6, confidence: "medium" },
    accessibility: { status: "observed", value: "easy", confidence: "medium" },
    condition: { status: "observed", value: "fair", confidence: "medium" },
    hardWaterStaining: { status: "unknown" },
    overallConfidence: "medium",
    warnings: ["All photos show the same front elevation; the rear and sides are not visible."],
  };

  it("stays at medium confidence rather than being inflated by photo count alone", () => {
    const result = reconcileObservation(observation, metadata);
    expect(result.metadata.confidence).toBe("medium");
    expect(result.metadata.notes).toContain(
      "All photos show the same front elevation; the rear and sides are not visible.",
    );
  });
});
