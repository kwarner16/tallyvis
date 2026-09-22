import { describe, expect, it } from "vitest";
import type { RawPropertyObservation } from "@tallyvis/ai";
import { useTestDb } from "./testHarness";
import { signUp } from "../services/auth";
import { createQuote, getQuote, getQuoteAiObservation } from "../services/quotes";
import {
  getJobOutcome,
  getQuoteObservationComparison,
  listQuotesWithOutcomes,
  recordJobOutcome,
} from "../services/jobOutcomes";

const getDb = useTestDb();

/**
 * Phase 13 — real-world job outcome & data collection foundation. See
 * docs/decisions/0015-job-outcome-tracking.md. Mirrors the tenancy,
 * authorization, and pricing-integrity conventions every other
 * services/api test suite already exercises against a real database —
 * nothing here is mocked.
 */

const sampleObservation = (windowCount = 18): RawPropertyObservation => ({
  vertical: "window-cleaning",
  stories: { status: "observed", value: 2, confidence: "high" },
  windowCount: { status: "observed", value: windowCount, confidence: "high" },
  windowType: { status: "observed", value: "double-hung", confidence: "high" },
  screens: { status: "observed", value: 6, confidence: "high" },
  tracks: { status: "observed", value: 0, confidence: "high" },
  accessibility: { status: "observed", value: "moderate", confidence: "high" },
  condition: { status: "observed", value: "good", confidence: "high" },
  hardWaterStaining: { status: "observed", value: false, confidence: "high" },
  overallConfidence: "high",
  warnings: [],
});

const sampleInput = (overrides?: { windowCount?: number; aiObservation?: RawPropertyObservation }) => ({
  customer: { name: "Jordan Rivera", email: "jordan@example.com", phone: "(555) 000-1111" },
  property: { propertyType: "single-family" as const, stories: 2, address: "1 Test St" },
  servicePreferences: {
    interiorCleaning: false,
    screens: true,
    tracks: false,
    hardWaterTreatment: "unsure" as const,
  },
  notes: "Side gate is unlocked.",
  photos: [],
  analysis: {
    characteristics: {
      vertical: "window-cleaning" as const,
      windowCount: overrides?.windowCount ?? 18,
      windowType: "double-hung" as const,
      paneCount: 0,
      stories: 2,
      screens: 6,
      tracks: 0,
      accessibility: "moderate" as const,
      condition: "good" as const,
      hardWaterStaining: false,
      estimatedLaborHours: 2.2,
      interiorCleaning: false,
    },
    metadata: { confidence: "high" as const },
  },
  aiObservation: overrides?.aiObservation,
});

async function setUp() {
  const db = getDb();
  const { session } = await signUp(db, {
    businessName: "Sparkle Windows",
    ownerEmail: "owner@sparkle.example",
    password: "correct-horse-battery",
  });
  return { db, session };
}

async function setUpTwoBusinesses() {
  const db = getDb();
  const a = await signUp(db, { businessName: "Business A", ownerEmail: "a@example.com", password: "password-a1" });
  const b = await signUp(db, { businessName: "Business B", ownerEmail: "b@example.com", password: "password-b1" });
  return { db, sessionA: a.session, sessionB: b.session };
}

describe("recordJobOutcome — creating and updating", () => {
  it("creates a new job outcome for a quote, defaulting to in_progress", async () => {
    const { db, session } = await setUp();
    const quote = await createQuote(db, session, sampleInput());

    const outcome = await recordJobOutcome(db, session, quote.id, {
      status: "in_progress",
      notes: "Started this morning.",
    });

    expect(outcome.quoteId).toBe(quote.id);
    expect(outcome.businessId).toBe(session.businessId);
    expect(outcome.status).toBe("in_progress");
    expect(outcome.notes).toBe("Started this morning.");
    expect(outcome.createdAt).toBeTruthy();
    expect(outcome.updatedAt).toBeTruthy();
  });

  it("records actual labor minutes directly", async () => {
    const { db, session } = await setUp();
    const quote = await createQuote(db, session, sampleInput());

    const outcome = await recordJobOutcome(db, session, quote.id, {
      status: "completed",
      actualLaborMinutes: 145,
      notes: "",
    });

    expect(outcome.actualLaborMinutes).toBe(145);
  });

  it("records the actual/final price", async () => {
    const { db, session } = await setUp();
    const quote = await createQuote(db, session, sampleInput());

    const outcome = await recordJobOutcome(db, session, quote.id, {
      status: "completed",
      actualPrice: 189.5,
      notes: "",
    });

    expect(outcome.actualPrice).toBe(189.5);
  });

  it("records a partial outcome — only some fields known, the rest simply absent, not zeroed or guessed", async () => {
    const { db, session } = await setUp();
    const quote = await createQuote(db, session, sampleInput());

    const outcome = await recordJobOutcome(db, session, quote.id, {
      status: "in_progress",
      actualWindowCount: 20,
      notes: "Counted windows on arrival; haven't finished yet.",
    });

    expect(outcome.actualWindowCount).toBe(20);
    expect(outcome.actualPrice).toBeUndefined();
    expect(outcome.actualLaborMinutes).toBeUndefined();
    expect(outcome.actualStartedAt).toBeUndefined();
    expect(outcome.actualCompletedAt).toBeUndefined();
    expect(outcome.actualDifficulty).toBeUndefined();
  });

  it("updates the same outcome in place on a second call, rather than creating a duplicate", async () => {
    const { db, session } = await setUp();
    const quote = await createQuote(db, session, sampleInput());

    const first = await recordJobOutcome(db, session, quote.id, { status: "in_progress", notes: "Started." });
    const second = await recordJobOutcome(db, session, quote.id, {
      status: "completed",
      actualPrice: 200,
      actualLaborMinutes: 120,
      notes: "Done.",
    });

    expect(second.id).toBe(first.id);
    expect(second.status).toBe("completed");
    expect(second.actualPrice).toBe(200);

    const outcomes = await listQuotesWithOutcomes(db, session);
    expect(outcomes.filter((o) => o.quote.id === quote.id)).toHaveLength(1);
  });

  it("throws for a quote that doesn't exist", async () => {
    const { db, session } = await setUp();
    await expect(
      recordJobOutcome(db, session, "quote_does-not-exist", { status: "in_progress", notes: "" }),
    ).rejects.toThrow(/not found/);
  });
});

describe("tenant isolation and quote ownership", () => {
  it("Business B cannot record an outcome for Business A's quote", async () => {
    const { db, sessionA, sessionB } = await setUpTwoBusinesses();
    const quoteA = await createQuote(db, sessionA, sampleInput());

    await expect(
      recordJobOutcome(db, sessionB, quoteA.id, { status: "completed", actualPrice: 999, notes: "" }),
    ).rejects.toThrow(/not found/);

    // Confirm nothing was written under Business A either.
    expect(await getJobOutcome(db, sessionA, quoteA.id)).toBeUndefined();
  });

  it("Business B cannot read Business A's recorded outcome", async () => {
    const { db, sessionA, sessionB } = await setUpTwoBusinesses();
    const quoteA = await createQuote(db, sessionA, sampleInput());
    await recordJobOutcome(db, sessionA, quoteA.id, { status: "completed", actualPrice: 150, notes: "" });

    expect((await getJobOutcome(db, sessionA, quoteA.id))?.actualPrice).toBe(150);
    await expect(getJobOutcome(db, sessionB, quoteA.id)).rejects.toThrow(/not found/);
  });

  it("each business's job-outcomes list only ever contains its own quotes", async () => {
    const { db, sessionA, sessionB } = await setUpTwoBusinesses();
    await createQuote(db, sessionA, sampleInput());
    await createQuote(db, sessionB, sampleInput());

    expect(await listQuotesWithOutcomes(db, sessionA)).toHaveLength(1);
    expect(await listQuotesWithOutcomes(db, sessionB)).toHaveLength(1);
  });
});

describe("preserving the quote's original pricing and analysis", () => {
  it("recording an outcome never changes the quote's estimate, pricingConfigId, or analysis", async () => {
    const { db, session } = await setUp();
    const quote = await createQuote(db, session, sampleInput());
    const before = (await getQuote(db, session, quote.id))!;

    await recordJobOutcome(db, session, quote.id, {
      status: "completed",
      actualPrice: before.estimate.total + 500, // deliberately different from the original estimate
      actualLaborMinutes: 999,
      notes: "Took much longer than expected.",
    });

    const after = (await getQuote(db, session, quote.id))!;
    expect(after.estimate).toEqual(before.estimate);
    expect(after.pricingConfigId).toBe(before.pricingConfigId);
    expect(after.analysis).toEqual(before.analysis);
    expect(after.status).toBe(before.status);
  });
});

describe("AI-observed vs human-confirmed values", () => {
  it("preserves the AI's raw observation separately from the confirmed characteristics — both retained, never collapsed", async () => {
    const { db, session } = await setUp();
    const observation = sampleObservation(18);
    // The human confirmed 24 windows even though the AI observed 18 — the
    // brief's own example.
    const quote = await createQuote(db, session, sampleInput({ windowCount: 24, aiObservation: observation }));

    const storedObservation = await getQuoteAiObservation(db, session, quote.id);
    expect(storedObservation?.windowCount).toEqual({ status: "observed", value: 18, confidence: "high" });
    expect(quote.analysis.characteristics.windowCount).toBe(24);
  });

  it("computes a field-by-field comparison flagging exactly the corrected field", async () => {
    const { db, session } = await setUp();
    const observation = sampleObservation(18);
    const quote = await createQuote(db, session, sampleInput({ windowCount: 24, aiObservation: observation }));

    const comparison = await getQuoteObservationComparison(db, session, quote.id);
    expect(comparison).toBeDefined();
    const windowRow = comparison!.find((row) => row.field === "windowCount")!;
    expect(windowRow.observedText).toBe("18");
    expect(windowRow.confirmedText).toBe("24");
    expect(windowRow.corrected).toBe(true);

    // Every other field matched what was observed, so nothing else is flagged.
    expect(comparison!.filter((row) => row.corrected)).toHaveLength(1);
  });

  it("returns undefined (not an empty comparison) when the quote was never analyzed by AI", async () => {
    const { db, session } = await setUp();
    const quote = await createQuote(db, session, sampleInput()); // no aiObservation

    expect(await getQuoteObservationComparison(db, session, quote.id)).toBeUndefined();
  });

  it("the job-outcomes summary correctly flags aiUsed and aiCorrected per quote", async () => {
    const { db, session } = await setUp();
    await createQuote(db, session, sampleInput()); // manual — no AI
    await createQuote(db, session, sampleInput({ windowCount: 18, aiObservation: sampleObservation(18) })); // AI, unmodified
    await createQuote(db, session, sampleInput({ windowCount: 30, aiObservation: sampleObservation(18) })); // AI, corrected

    const summaries = await listQuotesWithOutcomes(db, session);
    const manual = summaries.find((s) => s.quote.analysis.characteristics.windowCount === 18 && s.aiUsed === false);
    const uncorrected = summaries.find((s) => s.aiUsed && s.quote.analysis.characteristics.windowCount === 18);
    const corrected = summaries.find((s) => s.aiUsed && s.quote.analysis.characteristics.windowCount === 30);

    expect(manual?.aiUsed).toBe(false);
    expect(manual?.aiCorrected).toBeUndefined();
    expect(uncorrected?.aiCorrected).toBe(false);
    expect(corrected?.aiCorrected).toBe(true);
  });
});

describe("normal (non-AI) quote creation is unaffected", () => {
  it("a quote created without any aiObservation still works exactly as before", async () => {
    const { db, session } = await setUp();
    const quote = await createQuote(db, session, sampleInput());
    expect(quote.estimate.total).toBeGreaterThan(0);

    expect(await getQuoteAiObservation(db, session, quote.id)).toBeUndefined();
  });
});
