import { describe, expect, it } from "vitest";
import type { PropertyAnalysisResult } from "@tallyvis/types";
import type { RawPropertyObservation } from "@tallyvis/ai";
import { useTestDb } from "./testHarness";
import { signUp } from "../services/auth";
import {
  createQuote,
  createQuotePublic,
  determineInitialQuoteStatus,
  getQuote,
  getQuoteAiObservation,
  listQuotes,
  updateQuotePublic,
} from "../services/quotes";
import { getDefaultPublicBusiness } from "../services/business";

/**
 * Vision V1.1 (docs/decisions/0023-guided-capture-evidence-confidence.md)
 * — "business owner review is the exception path, not the default."
 * `needs_review` already existed as a `QuoteStatus` with a full dashboard
 * workflow (badge, filter, approve/send/request-more-info/reject actions);
 * these tests cover the actual escalation POLICY newly wired into
 * `persistPricedQuote` — the thing that decides whether a new quote lands
 * there or in the normal "new" queue.
 */

const getDb = useTestDb();

function observation(overrides: Partial<RawPropertyObservation> = {}): RawPropertyObservation {
  return {
    vertical: "window-cleaning",
    stories: { status: "observed", value: 2, confidence: "high" },
    windowCount: { status: "observed", value: 18, confidence: "high" },
    windowType: { status: "observed", value: "double-hung", confidence: "high" },
    screens: { status: "observed", value: 8, confidence: "high" },
    tracks: { status: "observed", value: 8, confidence: "high" },
    accessibility: { status: "observed", value: "moderate", confidence: "high" },
    condition: { status: "observed", value: "good", confidence: "high" },
    hardWaterStaining: { status: "observed", value: false, confidence: "high" },
    overallConfidence: "high",
    warnings: [],
    evidence: { coverage: "complete", overallEvidence: "sufficient", issues: [] },
    ...overrides,
  };
}

function analysisWith(confidence: PropertyAnalysisResult["metadata"]["confidence"]): PropertyAnalysisResult {
  return {
    characteristics: {
      vertical: "window-cleaning",
      windowCount: 18,
      windowType: "double-hung",
      paneCount: 0,
      stories: 2,
      screens: 6,
      tracks: 0,
      accessibility: "moderate",
      condition: "good",
      hardWaterStaining: false,
      estimatedLaborHours: 2.2,
      interiorCleaning: false,
    },
    metadata: { confidence },
  };
}

describe("determineInitialQuoteStatus — pure policy", () => {
  it("stays 'new' when there is no AI observation at all (manual entry, already human-reviewed)", () => {
    expect(determineInitialQuoteStatus(analysisWith("low"), undefined)).toBe("new");
  });

  it("stays 'new' when confidence is high and evidence is sufficient", () => {
    expect(determineInitialQuoteStatus(analysisWith("high"), observation())).toBe("new");
  });

  it("escalates to 'needs_review' when confidence is anything short of high", () => {
    expect(determineInitialQuoteStatus(analysisWith("medium"), observation())).toBe("needs_review");
    expect(determineInitialQuoteStatus(analysisWith("low"), observation())).toBe("needs_review");
  });

  it("escalates to 'needs_review' when evidence itself is insufficient, even if confidence claims high", () => {
    const highConfidenceButBadEvidence = observation({
      evidence: { coverage: "insufficient", overallEvidence: "insufficient", issues: ["distance", "vegetation"] },
    });
    expect(determineInitialQuoteStatus(analysisWith("high"), highConfidenceButBadEvidence)).toBe("needs_review");
  });

  it("stays 'new' for 'usable_with_uncertainty' evidence once confidence is genuinely high (historical coverage uncertainty was resolved by confirmation, not a permanent review trigger)", () => {
    const resolvedAfterConfirmation = observation({
      evidence: { coverage: "partial", overallEvidence: "usable_with_uncertainty", issues: ["distance"] },
    });
    expect(determineInitialQuoteStatus(analysisWith("high"), resolvedAfterConfirmation)).toBe("new");
  });

  it("still escalates 'usable_with_uncertainty' evidence when confidence was never actually resolved to high", () => {
    const stillUncertain = observation({
      evidence: { coverage: "partial", overallEvidence: "usable_with_uncertainty", issues: ["distance"] },
    });
    expect(determineInitialQuoteStatus(analysisWith("medium"), stillUncertain)).toBe("needs_review");
  });
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

function sampleInput(aiObservation: RawPropertyObservation | undefined, confidence: PropertyAnalysisResult["metadata"]["confidence"]) {
  return {
    customer: { name: "Jordan Rivera", email: "jordan@example.com", phone: "(555) 000-1111" },
    property: { propertyType: "single-family" as const, stories: 2, address: "1 Test St" },
    servicePreferences: { interiorCleaning: false, screens: true, tracks: false, hardWaterTreatment: "unsure" as const },
    notes: "",
    photos: [],
    analysis: analysisWith(confidence),
    aiObservation,
  };
}

describe("createQuotePublic — escalation wired end-to-end", () => {
  it("saves a high-confidence, sufficient-evidence quote as 'new'", async () => {
    const { db } = await setUp();
    const business = (await getDefaultPublicBusiness(db))!;
    const quote = await createQuotePublic(db, business.id, sampleInput(observation(), "high"));
    expect(quote.status).toBe("new");
  });

  it("saves a low-confidence quote as 'needs_review' rather than 'new'", async () => {
    const { db } = await setUp();
    const business = (await getDefaultPublicBusiness(db))!;
    const quote = await createQuotePublic(db, business.id, sampleInput(observation(), "low"));
    expect(quote.status).toBe("needs_review");
  });

  it("saves a quote with insufficient photo evidence as 'needs_review' even when the model claims high confidence", async () => {
    const { db } = await setUp();
    const business = (await getDefaultPublicBusiness(db))!;
    const badEvidence = observation({
      evidence: { coverage: "insufficient", overallEvidence: "insufficient", issues: ["distance"] },
    });
    const quote = await createQuotePublic(db, business.id, sampleInput(badEvidence, "high"));
    expect(quote.status).toBe("needs_review");
  });

  it("saves a manually-entered quote (no AI observation) as 'new' regardless of confidence", async () => {
    const { db } = await setUp();
    const business = (await getDefaultPublicBusiness(db))!;
    const quote = await createQuotePublic(db, business.id, sampleInput(undefined, "low"));
    expect(quote.status).toBe("new");
  });

  it("saves a quote with merely 'usable_with_uncertainty' evidence as 'new' once confirmation resolved confidence to high", async () => {
    const { db } = await setUp();
    const business = (await getDefaultPublicBusiness(db))!;
    const resolvedAfterConfirmation = observation({
      evidence: { coverage: "partial", overallEvidence: "usable_with_uncertainty", issues: ["distance"] },
    });
    const quote = await createQuotePublic(db, business.id, sampleInput(resolvedAfterConfirmation, "high"));
    expect(quote.status).toBe("new");
  });
});

describe("updateQuotePublic — re-analysis writes back to the SAME quote (2026-09 incident: a customer going back to add another photo after landing on /estimate/result previously had the improved analysis silently discarded)", () => {
  it("overwrites the existing quote's analysis/estimate/status rather than creating a second one", async () => {
    const { db, session } = await setUp();
    const business = (await getDefaultPublicBusiness(db))!;
    const badEvidence = observation({
      evidence: { coverage: "insufficient", overallEvidence: "insufficient", issues: ["distance"] },
    });
    const created = await createQuotePublic(db, business.id, sampleInput(badEvidence, "high"));
    expect(created.status).toBe("needs_review");

    // The customer went back, added another photo, and got a better result.
    const improved = observation({ windowCount: { status: "observed", value: 24, confidence: "high" } });
    const updated = await updateQuotePublic(db, business.id, created.id, sampleInput(improved, "high"));

    expect(updated.id).toBe(created.id);
    expect(updated.status).toBe("new");
    expect(updated.analysis.characteristics.windowCount).toBe(18); // sampleInput's own characteristics are unchanged by the observation override — this asserts the SAME analysis object flows through unmodified.

    const observationOnRecord = await getQuoteAiObservation(db, session, created.id);
    expect(observationOnRecord?.windowCount).toEqual({ status: "observed", value: 24, confidence: "high" });

    // Still exactly one quote for this business — the update replaced the
    // row in place, it never created a second one.
    const all = await listQuotes(db, session);
    expect(all.filter((q) => q.id === created.id)).toHaveLength(1);
    expect(all).toHaveLength(1);
  });

  it("re-derives status from the NEW analysis, not the original — a re-analysis can resolve the evidence gap that originally caused needs_review", async () => {
    const { db } = await setUp();
    const business = (await getDefaultPublicBusiness(db))!;
    const created = await createQuotePublic(db, business.id, sampleInput(observation(), "low"));
    expect(created.status).toBe("needs_review");

    const updated = await updateQuotePublic(db, business.id, created.id, sampleInput(observation(), "high"));
    expect(updated.status).toBe("new");
  });

  it("scopes the update to the resolved business — cannot update a different business's quote even by guessing its id", async () => {
    const { db, session } = await setUp();
    const business = (await getDefaultPublicBusiness(db))!;
    expect(business.id).toBe(session.businessId);
    const created = await createQuotePublic(db, business.id, sampleInput(observation(), "high"));

    await expect(
      updateQuotePublic(db, "business_some_other_business", created.id, sampleInput(observation(), "low")),
    ).rejects.toThrow(/quote not found/i);

    // The real quote is completely untouched by the failed cross-business attempt.
    const stillOriginal = await getQuote(db, session, created.id);
    expect(stillOriginal?.status).toBe(created.status);
    expect(stillOriginal?.analysis.metadata.confidence).toBe("high");
  });

  it("throws for a quote id that doesn't exist", async () => {
    const { db } = await setUp();
    const business = (await getDefaultPublicBusiness(db))!;
    await expect(
      updateQuotePublic(db, business.id, "quote_does_not_exist", sampleInput(observation(), "high")),
    ).rejects.toThrow(/quote not found/i);
  });
});

describe("createQuote (business dashboard path) — same escalation policy applies", () => {
  it("escalates a low-confidence AI-assisted quote the business saves without full review", async () => {
    const { db, session } = await setUp();
    const quote = await createQuote(db, session, sampleInput(observation(), "medium"));
    expect(quote.status).toBe("needs_review");
  });
});
