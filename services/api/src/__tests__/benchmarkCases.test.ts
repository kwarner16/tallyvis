import { describe, expect, it } from "vitest";
import type { RawPropertyObservation } from "@tallyvis/ai";
import type { WindowCleaningCharacteristics } from "@tallyvis/types";
import { useTestDb } from "./testHarness";
import { signUp } from "../services/auth";
import {
  computeBenchmarkMetrics,
  deleteBenchmarkCase,
  listBenchmarkCases,
  saveBenchmarkCase,
  type SaveBenchmarkCaseInput,
} from "../services/benchmarkCases";
import type { BenchmarkCase } from "../repositories/benchmarkCases";

/**
 * Final validation & launch-readiness phase (2026-09) — the internal
 * estimator benchmark harness. Covers (a) that saving/listing a case
 * round-trips through Postgres correctly and reuses the real escalation
 * policy, and (b) `computeBenchmarkMetrics`'s arithmetic against hand-built
 * fixtures, independent of the database.
 */

const getDb = useTestDb();

function observation(overrides: Partial<RawPropertyObservation> = {}): RawPropertyObservation {
  return {
    vertical: "window-cleaning",
    stories: { status: "observed", value: 2, confidence: "high" },
    windowCount: { status: "observed", value: 6, confidence: "high" },
    windowType: { status: "observed", value: "double-hung", confidence: "high" },
    screens: { status: "observed", value: 4, confidence: "high" },
    tracks: { status: "observed", value: 4, confidence: "high" },
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
    windowCount: 6,
    windowType: "double-hung",
    paneCount: 0,
    stories: 2,
    screens: 4,
    tracks: 4,
    accessibility: "moderate",
    condition: "good",
    hardWaterStaining: false,
    estimatedLaborHours: 1.5,
    interiorCleaning: false,
    ...overrides,
  };
}

async function setUp() {
  const db = getDb();
  const { session } = await signUp(db, {
    businessName: "Benchmark Co",
    ownerEmail: "owner@benchmark.example",
    password: "correct-horse-battery",
  });
  return { db, session };
}

function baseInput(overrides: Partial<SaveBenchmarkCaseInput> = {}): SaveBenchmarkCaseInput {
  return {
    testedAt: "2026-09-24T20:00:00.000Z",
    notes: "",
    conditions: ["clear_daylight"],
    photoCount: 3,
    observation: observation(),
    reconciledCharacteristics: characteristics(),
    confirmedCharacteristics: characteristics(),
    anyUnsure: false,
    groundTruth: { windowCount: 8, screenCount: 4, stories: 2, accessibility: "moderate" },
    ...overrides,
  };
}

describe("saveBenchmarkCase / listBenchmarkCases", () => {
  it("persists the AI observation, confirmed characteristics, and ground truth separately without ever overwriting the AI's original values", async () => {
    const { db, session } = await setUp();
    await saveBenchmarkCase(db, session, baseInput());
    const [saved] = await listBenchmarkCases(db, session);

    expect(saved!.ai.windowCount).toBe(6);
    expect(saved!.confirmed.characteristics.windowCount).toBe(6);
    expect(saved!.groundTruth.windowCount).toBe(8);
    expect(saved!.ai.observation.windowCount).toEqual({ status: "observed", value: 6, confidence: "high" });
  });

  it("reuses the real escalation policy — a sufficient-evidence, fully confirmed case is not flagged for review", async () => {
    const { db, session } = await setUp();
    const saved = await saveBenchmarkCase(db, session, baseInput());
    expect(saved.confirmed.wouldNeedReview).toBe(false);
    expect(saved.confirmed.confidence).toBe("high");
  });

  it("flags a case for review when evidence was insufficient, exactly like a real quote would be", async () => {
    const { db, session } = await setUp();
    const saved = await saveBenchmarkCase(
      db,
      session,
      baseInput({
        observation: observation({
          evidence: { coverage: "insufficient", overallEvidence: "insufficient", issues: ["distance"] },
        }),
      }),
    );
    expect(saved.confirmed.wouldNeedReview).toBe(true);
    expect(saved.ai.morePhotosRecommended).toBe(true);
    expect(saved.ai.evidenceMessages.length).toBeGreaterThan(0);
  });

  it("computes a real final price from the confirmed characteristics via the actual pricing engine", async () => {
    const { db, session } = await setUp();
    const saved = await saveBenchmarkCase(db, session, baseInput());
    expect(saved.confirmed.estimate.total).toBeGreaterThan(0);
  });

  it("only ever lists this business's own benchmark cases", async () => {
    const { db, session: sessionA } = await setUp();
    const { session: sessionB } = await signUp(db, {
      businessName: "Other Co",
      ownerEmail: "owner@other.example",
      password: "correct-horse-battery",
    });
    await saveBenchmarkCase(db, sessionA, baseInput());
    const forB = await listBenchmarkCases(db, sessionB);
    expect(forB).toHaveLength(0);
  });

  it("deletes only the calling business's own case", async () => {
    const { db, session: sessionA } = await setUp();
    const { session: sessionB } = await signUp(db, {
      businessName: "Other Co 2",
      ownerEmail: "owner@other2.example",
      password: "correct-horse-battery",
    });
    const saved = await saveBenchmarkCase(db, sessionA, baseInput());
    await deleteBenchmarkCase(db, sessionB, saved.id);
    expect(await listBenchmarkCases(db, sessionA)).toHaveLength(1);
    await deleteBenchmarkCase(db, sessionA, saved.id);
    expect(await listBenchmarkCases(db, sessionA)).toHaveLength(0);
  });
});

describe("computeBenchmarkMetrics", () => {
  function fixtureCase(overrides: Partial<BenchmarkCase> = {}): BenchmarkCase {
    return {
      id: overrides.id ?? `case_${Math.random()}`,
      businessId: "biz_1",
      testedAt: "2026-09-24T20:00:00.000Z",
      notes: "",
      conditions: [],
      photoCount: 3,
      ai: {
        observation: observation(),
        windowCount: 6,
        windowStatus: "observed",
        screenCount: 4,
        screenStatus: "observed",
        stories: 2,
        storiesStatus: "observed",
        overallConfidence: "high",
        evidenceCoverage: "complete",
        evidenceOverall: "sufficient",
        evidenceIssues: [],
        morePhotosRecommended: false,
        evidenceMessages: [],
      },
      confirmed: {
        characteristics: characteristics(),
        confidence: "high",
        wouldNeedReview: false,
        estimate: { lineItems: [], subtotal: 100, total: 100, currency: "USD", confidence: "high" },
      },
      groundTruth: { windowCount: 8, screenCount: 4, stories: 2, accessibility: "moderate" },
      createdAt: "2026-09-24T20:00:00.000Z",
      ...overrides,
    };
  }

  it("computes raw recall, absolute error, and tracks overcounts separately from recall", () => {
    const cases = [
      fixtureCase({ ai: { ...fixtureCase().ai, windowCount: 6 }, groundTruth: { windowCount: 8 } }), // undercount: recall 0.75
      fixtureCase({ ai: { ...fixtureCase().ai, windowCount: 10 }, groundTruth: { windowCount: 8 } }), // overcount
    ];
    const metrics = computeBenchmarkMetrics(cases);
    expect(metrics.casesWithWindowGroundTruth).toBe(2);
    expect(metrics.avgRawRecall).toBeCloseTo((6 / 8 + 10 / 8) / 2, 5);
    expect(metrics.overcountRate).toBe(0.5);
    expect(metrics.avgAbsWindowError).toBeCloseTo((2 + 2) / 2, 5);
  });

  it("computes exact/within-1/within-2 rates", () => {
    const cases = [
      fixtureCase({ ai: { ...fixtureCase().ai, windowCount: 8 }, groundTruth: { windowCount: 8 } }), // exact
      fixtureCase({ ai: { ...fixtureCase().ai, windowCount: 7 }, groundTruth: { windowCount: 8 } }), // within 1
      fixtureCase({ ai: { ...fixtureCase().ai, windowCount: 5 }, groundTruth: { windowCount: 8 } }), // error of 3 — outside every bucket, verifying the ±2 boundary is exclusive
    ];
    const metrics = computeBenchmarkMetrics(cases);
    expect(metrics.exactCountRate).toBeCloseTo(1 / 3, 5);
    expect(metrics.within1Rate).toBeCloseTo(2 / 3, 5);
    expect(metrics.within2Rate).toBeCloseTo(2 / 3, 5);
  });

  it("excludes cases where the AI declined to count from recall/error, but reports the decline rate", () => {
    const cases = [
      fixtureCase({ ai: { ...fixtureCase().ai, windowCount: undefined, windowStatus: "unknown" }, groundTruth: { windowCount: 8 } }),
      fixtureCase({ ai: { ...fixtureCase().ai, windowCount: 8 }, groundTruth: { windowCount: 8 } }),
    ];
    const metrics = computeBenchmarkMetrics(cases);
    expect(metrics.aiDeclinedToCountRate).toBe(0.5);
    expect(metrics.exactCountRate).toBe(1); // computed only over the one case the AI actually counted
  });

  it("computes customer-confirmed accuracy separately from raw AI accuracy", () => {
    const cases = [
      fixtureCase({
        ai: { ...fixtureCase().ai, windowCount: 5 },
        confirmed: { ...fixtureCase().confirmed, characteristics: characteristics({ windowCount: 8 }) },
        groundTruth: { windowCount: 8 },
      }),
    ];
    const metrics = computeBenchmarkMetrics(cases);
    expect(metrics.avgAbsWindowError).toBe(3); // raw AI was off by 3
    expect(metrics.avgAbsConfirmedWindowError).toBe(0); // but the confirmed value matched ground truth
    expect(metrics.confirmedExactCountRate).toBe(1);
  });

  it("breaks down accuracy by condition tag", () => {
    const cases = [
      fixtureCase({ conditions: ["distant_photo"], ai: { ...fixtureCase().ai, windowCount: 5 }, groundTruth: { windowCount: 8 } }),
      fixtureCase({ conditions: ["clear_daylight"], ai: { ...fixtureCase().ai, windowCount: 8 }, groundTruth: { windowCount: 8 } }),
    ];
    const metrics = computeBenchmarkMetrics(cases);
    const distant = metrics.byCondition.find((c) => c.condition === "distant_photo")!;
    const clear = metrics.byCondition.find((c) => c.condition === "clear_daylight")!;
    expect(distant.avgAbsWindowError).toBe(3);
    expect(clear.avgAbsWindowError).toBe(0);
  });

  it("tracks whether a follow-up photo request was actually followed by an improved re-run", () => {
    const first = fixtureCase({
      id: "case_a",
      ai: { ...fixtureCase().ai, windowCount: 5, evidenceOverall: "insufficient", morePhotosRecommended: true },
      groundTruth: { windowCount: 8 },
    });
    const improvedFollowUp = fixtureCase({
      id: "case_b",
      previousCaseId: "case_a",
      ai: { ...fixtureCase().ai, windowCount: 8, evidenceOverall: "sufficient" },
      groundTruth: { windowCount: 8 },
    });
    const metrics = computeBenchmarkMetrics([first, improvedFollowUp]);
    expect(metrics.followUpPhotos.recommendedCount).toBe(1);
    expect(metrics.followUpPhotos.followUpCasesCount).toBe(1);
    expect(metrics.followUpPhotos.improvedCount).toBe(1);
  });

  it("returns nulls (not NaN/zero) for metrics with no applicable ground truth", () => {
    const metrics = computeBenchmarkMetrics([fixtureCase({ groundTruth: {} })]);
    expect(metrics.avgRawRecall).toBeNull();
    expect(metrics.avgAbsWindowError).toBeNull();
    expect(metrics.exactCountRate).toBeNull();
  });
});
