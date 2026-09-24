import { describe, expect, it } from "vitest";
import { safeParseJson, summarizeObservationForLogging, validateRawPropertyObservation } from "../validateObservation";

/**
 * All AI output is untrusted external data (Phase 11 — see
 * docs/decisions/0013-ai-analysis-foundation.md). These tests exercise
 * every failure mode the brief calls out explicitly: malformed JSON,
 * missing fields, invalid enums, invalid/absurd numbers, and the
 * uncertainty representation itself — not just the happy path.
 *
 * Phase 12.1 (docs/decisions/0022-graceful-partial-ai-analysis.md) split
 * failures into two severities. Only a non-object input or a mismatched
 * `vertical` still hard-rejects the whole observation (`ok: false`) —
 * every other malformed shape (a missing confidence, an invalid enum, an
 * out-of-range number, a bad status) degrades just that one field to
 * `{status: "unknown"}` with a recorded warning, while the rest of the
 * observation — and the observation as a whole — stays usable.
 */

function validObservation() {
  return {
    vertical: "window-cleaning",
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
    evidence: { coverage: "complete", overallEvidence: "sufficient", issues: [] },
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
      evidence: { coverage: "insufficient", overallEvidence: "insufficient", issues: ["distance"] },
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

describe("validateRawPropertyObservation — hard rejection (no per-field data to salvage)", () => {
  it("rejects non-object top-level input", () => {
    expect(validateRawPropertyObservation(null).ok).toBe(false);
    expect(validateRawPropertyObservation(undefined).ok).toBe(false);
    expect(validateRawPropertyObservation("a string").ok).toBe(false);
    expect(validateRawPropertyObservation(42).ok).toBe(false);
    expect(validateRawPropertyObservation([1, 2, 3]).ok).toBe(false);
  });

  it("rejects a wrong vertical", () => {
    const result = validateRawPropertyObservation({ ...validObservation(), vertical: "pressure-washing" });
    expect(result.ok).toBe(false);
  });

  it("rejects a missing vertical", () => {
    const input = validObservation() as Record<string, unknown>;
    delete input.vertical;
    expect(validateRawPropertyObservation(input).ok).toBe(false);
  });
});

describe("validateRawPropertyObservation — graceful degradation (one bad field doesn't discard the rest)", () => {
  it("degrades a missing field to unknown instead of rejecting the whole observation", () => {
    const input = validObservation() as Record<string, unknown>;
    delete input.windowCount;
    const result = validateRawPropertyObservation(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.windowCount).toEqual({ status: "unknown" });
    // Every other field is untouched — the point of graceful degradation.
    expect(result.value.stories).toEqual({ status: "observed", value: 2, confidence: "high" });
    expect(result.value.warnings.join(" ")).toMatch(/windowCount/);
  });

  it("degrades an invalid enum value to unknown, keeping the rest of the observation", () => {
    const input = { ...validObservation(), accessibility: { status: "observed", value: "impossible", confidence: "high" } };
    const result = validateRawPropertyObservation(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.accessibility).toEqual({ status: "unknown" });
    expect(result.value.warnings.join(" ")).toMatch(/accessibility/);
  });

  it("degrades an observed value missing its confidence to unknown", () => {
    const input = { ...validObservation(), stories: { status: "observed", value: 2 } };
    const result = validateRawPropertyObservation(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stories).toEqual({ status: "unknown" });
    expect(result.value.warnings.join(" ")).toMatch(/stories/);
  });

  it("degrades an observed value with an invalid confidence level to unknown", () => {
    const input = { ...validObservation(), stories: { status: "observed", value: 2, confidence: "extremely-sure" } };
    const result = validateRawPropertyObservation(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.stories).toEqual({ status: "unknown" });
  });

  it("degrades an unrecognized status to unknown", () => {
    const input = { ...validObservation(), windowCount: { status: "guessed", value: 24, confidence: "high" } };
    const result = validateRawPropertyObservation(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.windowCount).toEqual({ status: "unknown" });
  });

  it("degrades a negative window count to unknown", () => {
    const input = { ...validObservation(), windowCount: { status: "observed", value: -5, confidence: "high" } };
    const result = validateRawPropertyObservation(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.windowCount).toEqual({ status: "unknown" });
  });

  it("degrades an absurd window count to unknown rather than trusting a hallucinated total", () => {
    const input = { ...validObservation(), windowCount: { status: "observed", value: 50000, confidence: "high" } };
    const result = validateRawPropertyObservation(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.windowCount).toEqual({ status: "unknown" });
  });

  it("degrades a non-integer window count to unknown", () => {
    const input = { ...validObservation(), windowCount: { status: "observed", value: 24.5, confidence: "high" } };
    const result = validateRawPropertyObservation(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.windowCount).toEqual({ status: "unknown" });
  });

  it("degrades NaN and Infinity to unknown", () => {
    const nanInput = { ...validObservation(), stories: { status: "observed", value: NaN, confidence: "high" } };
    const nanResult = validateRawPropertyObservation(nanInput);
    expect(nanResult.ok).toBe(true);
    if (nanResult.ok) expect(nanResult.value.stories).toEqual({ status: "unknown" });

    const infInput = { ...validObservation(), windowCount: { status: "observed", value: Infinity, confidence: "high" } };
    const infResult = validateRawPropertyObservation(infInput);
    expect(infResult.ok).toBe(true);
    if (infResult.ok) expect(infResult.value.windowCount).toEqual({ status: "unknown" });
  });

  it("degrades an absurd stories count to unknown", () => {
    const input = { ...validObservation(), stories: { status: "observed", value: 200, confidence: "high" } };
    const result = validateRawPropertyObservation(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.stories).toEqual({ status: "unknown" });
  });

  it("degrades a non-boolean hardWaterStaining value to unknown", () => {
    const input = { ...validObservation(), hardWaterStaining: { status: "observed", value: "yes", confidence: "high" } };
    const result = validateRawPropertyObservation(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.hardWaterStaining).toEqual({ status: "unknown" });
  });

  it("defaults a missing overallConfidence to \"low\" instead of rejecting", () => {
    const input = validObservation() as Record<string, unknown>;
    delete input.overallConfidence;
    const result = validateRawPropertyObservation(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.overallConfidence).toBe("low");
      expect(result.value.warnings.join(" ")).toMatch(/overallConfidence/);
    }
  });

  it("drops a non-string warnings entry rather than rejecting the whole observation", () => {
    const input = { ...validObservation(), warnings: ["fine", 42] };
    const result = validateRawPropertyObservation(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.warnings).toContain("fine");
  });

  it("caps an excessively long warnings array rather than rejecting it", () => {
    const input = { ...validObservation(), warnings: Array.from({ length: 100 }, (_, i) => `warning ${i}`) };
    const result = validateRawPropertyObservation(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.warnings.length).toBeLessThanOrEqual(20);
  });

  it("degrades every malformed field independently, ending up with one usable observation", () => {
    const input = {
      ...validObservation(),
      stories: { status: "observed", value: -1, confidence: "high" },
      windowCount: { status: "observed", value: 24 }, // missing confidence
      overallConfidence: "extremely-confident",
    };
    const result = validateRawPropertyObservation(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stories).toEqual({ status: "unknown" });
    expect(result.value.windowCount).toEqual({ status: "unknown" });
    expect(result.value.overallConfidence).toBe("low");
    // Untouched fields survive the other fields' degradation.
    expect(result.value.windowType).toEqual({ status: "observed", value: "double-hung", confidence: "medium" });
    expect(result.value.warnings.length).toBeGreaterThanOrEqual(3);
  });
});

describe("validateRawPropertyObservation — evidence assessment (Vision V1.1)", () => {
  it("accepts a valid evidence object", () => {
    const input = { ...validObservation(), evidence: { coverage: "partial", overallEvidence: "insufficient", issues: ["vegetation", "distance"] } };
    const result = validateRawPropertyObservation(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.evidence).toEqual({ coverage: "partial", overallEvidence: "insufficient", issues: ["vegetation", "distance"] });
  });

  it("degrades a missing evidence object to a conservative default rather than rejecting", () => {
    const input = validObservation() as Record<string, unknown>;
    delete input.evidence;
    const result = validateRawPropertyObservation(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.evidence).toEqual({ coverage: "partial", overallEvidence: "usable_with_uncertainty", issues: [] });
    expect(result.value.warnings.join(" ")).toMatch(/evidence/);
  });

  it("degrades an evidence object with an invalid overallEvidence to the conservative default", () => {
    const input = { ...validObservation(), evidence: { coverage: "complete", overallEvidence: "definitely-fine", issues: [] } };
    const result = validateRawPropertyObservation(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.evidence.overallEvidence).toBe("usable_with_uncertainty");
  });

  it("drops unrecognized issue tags and de-duplicates rather than rejecting", () => {
    const input = {
      ...validObservation(),
      evidence: { coverage: "partial", overallEvidence: "sufficient", issues: ["vegetation", "vegetation", "made-up-issue"] },
    };
    const result = validateRawPropertyObservation(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.evidence.issues).toEqual(["vegetation"]);
  });

  it("never lets evidence.overallEvidence alone hard-reject the observation", () => {
    const input = { ...validObservation(), evidence: { coverage: "insufficient", overallEvidence: "insufficient", issues: ["distance", "vegetation"] } };
    const result = validateRawPropertyObservation(input);
    expect(result.ok).toBe(true);
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

describe("summarizeObservationForLogging", () => {
  it("produces a safe, compact per-field summary with no photos/PII", () => {
    const result = validateRawPropertyObservation(validObservation());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const summary = summarizeObservationForLogging(result.value);
    expect(summary).toContain("windowCount=observed(24,medium)");
    expect(summary).toContain("stories=observed(2,high)");
    expect(summary).toContain("hardWaterStaining=unknown");
    expect(summary).toContain("overallConfidence=medium");
  });
});
