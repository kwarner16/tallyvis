import { describe, expect, it } from "vitest";
import { describeEvidenceGaps } from "../evidenceMessages";
import type { RawPropertyObservation } from "../types";

/**
 * Vision V1.1 (docs/decisions/0023-guided-capture-evidence-confidence.md)
 * — `describeEvidenceGaps` is a pure, deterministic mapping from
 * structured evidence to fixed, reviewed copy, never a generative call.
 * These tests exercise the mapping directly, not any AI behavior.
 */

function observationWith(evidence: RawPropertyObservation["evidence"]): RawPropertyObservation {
  return {
    vertical: "window-cleaning",
    stories: { status: "observed", value: 2, confidence: "high" },
    windowCount: { status: "uncertain", confidence: "medium" },
    windowType: { status: "unknown" },
    screens: { status: "unknown" },
    tracks: { status: "unknown" },
    accessibility: { status: "observed", value: "moderate", confidence: "medium" },
    condition: { status: "unknown" },
    hardWaterStaining: { status: "unknown" },
    overallConfidence: "medium",
    warnings: [],
    evidence,
  };
}

describe("describeEvidenceGaps", () => {
  it("returns nothing when evidence is sufficient", () => {
    const observation = observationWith({ coverage: "complete", overallEvidence: "sufficient", issues: [] });
    expect(describeEvidenceGaps(observation)).toEqual([]);
  });

  it("names a specific, actionable message per issue tag", () => {
    const observation = observationWith({
      coverage: "partial",
      overallEvidence: "insufficient",
      issues: ["vegetation", "distance"],
    });
    const messages = describeEvidenceGaps(observation);
    expect(messages).toHaveLength(2);
    expect(messages.some((m) => m.toLowerCase().includes("shrub") || m.toLowerCase().includes("tree"))).toBe(true);
    expect(messages.some((m) => m.toLowerCase().includes("closer"))).toBe(true);
  });

  it("prioritizes the unrelated-images message alone over every other issue", () => {
    const observation = observationWith({
      coverage: "partial",
      overallEvidence: "insufficient",
      issues: ["unrelated_images", "vegetation", "blur"],
    });
    const messages = describeEvidenceGaps(observation);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/same property/i);
  });

  it("falls back to a generic coverage message when evidence is insufficient but no specific issue was named", () => {
    const observation = observationWith({ coverage: "insufficient", overallEvidence: "insufficient", issues: [] });
    const messages = describeEvidenceGaps(observation);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/how much of the property/i);
  });

  it("falls back to a 'missing side' message for partial coverage with no specific issue", () => {
    const observation = observationWith({ coverage: "partial", overallEvidence: "usable_with_uncertainty", issues: [] });
    const messages = describeEvidenceGaps(observation);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/every side/i);
  });

  it("never returns an empty array for non-sufficient evidence — there is always something to say", () => {
    const observation = observationWith({ coverage: "complete", overallEvidence: "usable_with_uncertainty", issues: [] });
    expect(describeEvidenceGaps(observation).length).toBeGreaterThan(0);
  });
});
