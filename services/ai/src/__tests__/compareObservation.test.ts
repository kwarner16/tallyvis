import { describe, expect, it } from "vitest";
import { compareObservationToCharacteristics, wasObservationCorrected } from "../compareObservation";
import type { RawPropertyObservation } from "../types";
import type { WindowCleaningCharacteristics } from "@tallyvis/types";

/**
 * Phase 13 — see docs/decisions/0015-job-outcome-tracking.md.
 * `compareObservationToCharacteristics` is the pure data-collection
 * comparison between what the AI observed and what a human ultimately
 * confirmed — never a re-run of pricing or reconciliation, and it must
 * never conflate "the AI was uncertain" with "the AI was wrong."
 */

function observation(overrides: Partial<RawPropertyObservation> = {}): RawPropertyObservation {
  return {
    vertical: "window-cleaning",
    stories: { status: "observed", value: 2, confidence: "high" },
    windowCount: { status: "observed", value: 18, confidence: "high" },
    windowType: { status: "observed", value: "double-hung", confidence: "high" },
    screens: { status: "observed", value: 10, confidence: "high" },
    tracks: { status: "observed", value: 10, confidence: "high" },
    accessibility: { status: "observed", value: "moderate", confidence: "high" },
    condition: { status: "observed", value: "good", confidence: "high" },
    hardWaterStaining: { status: "observed", value: false, confidence: "high" },
    overallConfidence: "high",
    warnings: [],
    evidence: { coverage: "complete", overallEvidence: "sufficient", issues: [] },
    ...overrides,
  };
}

function characteristics(overrides: Partial<WindowCleaningCharacteristics> = {}): WindowCleaningCharacteristics {
  return {
    vertical: "window-cleaning",
    windowCount: 18,
    windowType: "double-hung",
    paneCount: 0,
    stories: 2,
    screens: 10,
    tracks: 10,
    accessibility: "moderate",
    condition: "good",
    hardWaterStaining: false,
    estimatedLaborHours: 2,
    interiorCleaning: false,
    ...overrides,
  };
}

describe("compareObservationToCharacteristics", () => {
  it("marks every field un-corrected when the confirmed values match what was observed", () => {
    const rows = compareObservationToCharacteristics(observation(), characteristics());
    expect(rows.every((row) => !row.corrected)).toBe(true);
    expect(wasObservationCorrected(observation(), characteristics())).toBe(false);
  });

  it("flags a field corrected when the AI observed a value and the human confirmed a different one — the brief's own example (18 windows observed, 24 confirmed)", () => {
    const rows = compareObservationToCharacteristics(
      observation({ windowCount: { status: "observed", value: 18, confidence: "high" } }),
      characteristics({ windowCount: 24 }),
    );
    const windowRow = rows.find((row) => row.field === "windowCount")!;
    expect(windowRow.observedText).toBe("18");
    expect(windowRow.confirmedText).toBe("24");
    expect(windowRow.corrected).toBe(true);
    expect(wasObservationCorrected(observation({ windowCount: { status: "observed", value: 18, confidence: "high" } }), characteristics({ windowCount: 24 }))).toBe(true);
  });

  it("both the AI-observed and human-confirmed values are retained side by side, never collapsed into one", () => {
    const rows = compareObservationToCharacteristics(
      observation({ accessibility: { status: "observed", value: "easy", confidence: "high" } }),
      characteristics({ accessibility: "difficult" }),
    );
    const row = rows.find((row) => row.field === "accessibility")!;
    expect(row.observedText).toBe("Easy");
    expect(row.confirmedText).toBe("Difficult");
  });

  it("does not treat an uncertain field the human filled in as a 'correction' — there was no committed AI value to override", () => {
    const rows = compareObservationToCharacteristics(
      observation({ windowCount: { status: "uncertain", confidence: "low" } }),
      characteristics({ windowCount: 24 }),
    );
    const row = rows.find((row) => row.field === "windowCount")!;
    expect(row.observedText).toBeNull();
    expect(row.status).toBe("uncertain");
    expect(row.corrected).toBe(false);
  });

  it("does not treat an unknown field the human filled in as a 'correction' either", () => {
    const rows = compareObservationToCharacteristics(
      observation({ condition: { status: "unknown" } }),
      characteristics({ condition: "fair" }),
    );
    const row = rows.find((row) => row.field === "condition")!;
    expect(row.observedText).toBeNull();
    expect(row.status).toBe("unknown");
    expect(row.corrected).toBe(false);
  });

  it("formats booleans as Yes/No, not true/false", () => {
    const rows = compareObservationToCharacteristics(
      observation({ hardWaterStaining: { status: "observed", value: true, confidence: "high" } }),
      characteristics({ hardWaterStaining: true }),
    );
    const row = rows.find((row) => row.field === "hardWaterStaining")!;
    expect(row.observedText).toBe("Yes");
    expect(row.confirmedText).toBe("Yes");
  });

  it("covers every field shared between RawPropertyObservation and WindowCleaningCharacteristics — no extras, no gaps", () => {
    const rows = compareObservationToCharacteristics(observation(), characteristics());
    expect(rows.map((row) => row.field).sort()).toEqual(
      ["accessibility", "condition", "hardWaterStaining", "screens", "stories", "tracks", "windowCount", "windowType"].sort(),
    );
  });
});
