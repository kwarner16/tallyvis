import { describe, expect, it } from "vitest";
import { safeParseJson, validateRawPropertyObservation } from "../validateObservation";

/**
 * All AI output is untrusted external data (Phase 11 — see
 * docs/decisions/0013-ai-analysis-foundation.md). These tests exercise
 * every failure mode the brief calls out explicitly: malformed JSON,
 * missing fields, invalid enums, invalid/absurd numbers, and the
 * uncertainty representation itself — not just the happy path.
 */

function validObservation() {
  return {
    vertical: "window-cleaning",
    propertyType: { status: "observed", value: "single-family", confidence: "high" },
    stories: { status: "observed", value: 2, confidence: "high" },
    windowCount: { status: "observed", value: 24, confidence: "medium" },
    windowType: { status: "observed", value: "double-hung", confidence: "medium" },
    screens: { status: "observed", value: 10, confidence: "medium" },
    tracks: { status: "observed", value: 10, confidence: "medium" },
    accessibility: { status: "uncertain", confidence: "low" },
    condition: { status: "observed", value: "good", confidence: "high" },
    hardWaterStaining: { status: "unknown" },
    overallConfidence: "medium",
    warnings: ["The rear of the property is not visible in any photo."],
  };
}

describe("validateRawPropertyObservation — positive cases", () => {
  it("accepts a fully valid response", () => {
    const result = validateRawPropertyObservation(validObservation());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stories).toEqual({ status: "observed", value: 2, confidence: "high" });
    expect(result.value.accessibility).toEqual({ status: "uncertain", confidence: "low" });
    expect(result.value.hardWaterStaining).toEqual({ status: "unknown" });
  });

  it("accepts every field as unknown — the AI is allowed to know nothing", () => {
    const allUnknown = {
      vertical: "window-cleaning",
      propertyType: { status: "unknown" },
      stories: { status: "unknown" },
      windowCount: { status: "unknown" },
      windowType: { status: "unknown" },
      screens: { status: "unknown" },
      tracks: { status: "unknown" },
      accessibility: { status: "unknown" },
      condition: { status: "unknown" },
      hardWaterStaining: { status: "unknown" },
      overallConfidence: "low",
      warnings: [],
    };
    const result = validateRawPropertyObservation(allUnknown);
    expect(result.ok).toBe(true);
  });

  it("defaults a missing warnings array to empty rather than rejecting", () => {
    const input = validObservation();
    delete (input as { warnings?: unknown }).warnings;
    const result = validateRawPropertyObservation(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.warnings).toEqual([]);
  });

  it("silently drops unexpected extra fields rather than trusting or rejecting them", () => {
    const input = { ...validObservation(), totalPrice: 1875, hourlyRate: 50 };
    const result = validateRawPropertyObservation(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).not.toHaveProperty("totalPrice");
      expect(result.value).not.toHaveProperty("hourlyRate");
    }
  });
});

describe("validateRawPropertyObservation — malformed/missing/invalid input", () => {
  it("rejects non-object top-level input", () => {
    expect(validateRawPropertyObservation(null).ok).toBe(false);
    expect(validateRawPropertyObservation(undefined).ok).toBe(false);
    expect(validateRawPropertyObservation("a string").ok).toBe(false);
    expect(validateRawPropertyObservation(42).ok).toBe(false);
    expect(validateRawPropertyObservation([1, 2, 3]).ok).toBe(false);
  });

  it("rejects a missing required field", () => {
    const input = validObservation() as Record<string, unknown>;
    delete input.windowCount;
    const result = validateRawPropertyObservation(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/windowCount/);
  });

  it("rejects an invalid enum value", () => {
    const input = { ...validObservation(), accessibility: { status: "observed", value: "impossible", confidence: "high" } };
    const result = validateRawPropertyObservation(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/accessibility/);
  });

  it("rejects a wrong vertical", () => {
    const result = validateRawPropertyObservation({ ...validObservation(), vertical: "pressure-washing" });
    expect(result.ok).toBe(false);
  });

  it("rejects an observed value missing its confidence", () => {
    const input = { ...validObservation(), stories: { status: "observed", value: 2 } };
    const result = validateRawPropertyObservation(input);
    expect(result.ok).toBe(false);
  });

  it("rejects an observed value with an invalid confidence level", () => {
    const input = { ...validObservation(), stories: { status: "observed", value: 2, confidence: "extremely-sure" } };
    expect(validateRawPropertyObservation(input).ok).toBe(false);
  });

  it("rejects an unrecognized status", () => {
    const input = { ...validObservation(), windowCount: { status: "guessed", value: 24, confidence: "high" } };
    expect(validateRawPropertyObservation(input).ok).toBe(false);
  });

  it("rejects a negative window count", () => {
    const input = { ...validObservation(), windowCount: { status: "observed", value: -5, confidence: "high" } };
    expect(validateRawPropertyObservation(input).ok).toBe(false);
  });

  it("rejects an absurd window count", () => {
    const input = { ...validObservation(), windowCount: { status: "observed", value: 50000, confidence: "high" } };
    expect(validateRawPropertyObservation(input).ok).toBe(false);
  });

  it("rejects a non-integer window count", () => {
    const input = { ...validObservation(), windowCount: { status: "observed", value: 24.5, confidence: "high" } };
    expect(validateRawPropertyObservation(input).ok).toBe(false);
  });

  it("rejects NaN and Infinity", () => {
    const nanInput = { ...validObservation(), stories: { status: "observed", value: NaN, confidence: "high" } };
    expect(validateRawPropertyObservation(nanInput).ok).toBe(false);
    const infInput = { ...validObservation(), windowCount: { status: "observed", value: Infinity, confidence: "high" } };
    expect(validateRawPropertyObservation(infInput).ok).toBe(false);
  });

  it("rejects an absurd stories count", () => {
    const input = { ...validObservation(), stories: { status: "observed", value: 200, confidence: "high" } };
    expect(validateRawPropertyObservation(input).ok).toBe(false);
  });

  it("rejects a non-boolean hardWaterStaining value", () => {
    const input = { ...validObservation(), hardWaterStaining: { status: "observed", value: "yes", confidence: "high" } };
    expect(validateRawPropertyObservation(input).ok).toBe(false);
  });

  it("rejects a missing overallConfidence", () => {
    const input = validObservation() as Record<string, unknown>;
    delete input.overallConfidence;
    expect(validateRawPropertyObservation(input).ok).toBe(false);
  });

  it("rejects a warnings array containing a non-string", () => {
    const input = { ...validObservation(), warnings: ["fine", 42] };
    expect(validateRawPropertyObservation(input).ok).toBe(false);
  });

  it("caps an excessively long warnings array rather than accepting it unbounded", () => {
    const input = { ...validObservation(), warnings: Array.from({ length: 100 }, (_, i) => `warning ${i}`) };
    expect(validateRawPropertyObservation(input).ok).toBe(false);
  });

  it("accumulates multiple errors in one pass rather than stopping at the first", () => {
    const input = {
      ...validObservation(),
      vertical: "wrong",
      stories: { status: "observed", value: -1, confidence: "high" },
      overallConfidence: "extremely-confident",
    };
    const result = validateRawPropertyObservation(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("safeParseJson", () => {
  it("parses valid JSON", () => {
    const result = safeParseJson('{"a": 1}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ a: 1 });
  });

  it("never throws on malformed JSON — returns a clean failure instead", () => {
    const result = safeParseJson("{not valid json");
    expect(result.ok).toBe(false);
  });

  it("handles an empty string safely", () => {
    expect(safeParseJson("").ok).toBe(false);
  });

  it("handles a model refusal/prose response safely (not JSON at all)", () => {
    expect(safeParseJson("I'm sorry, I can't help with that.").ok).toBe(false);
  });
});
