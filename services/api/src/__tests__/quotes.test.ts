import { describe, expect, it } from "vitest";
import { roundMoney } from "@tallyvis/pricing";
import { createTestDb } from "../db/client";
import { signUp } from "../services/auth";
import {
  createQuote,
  getQuote,
  listQuotes,
  recalculateQuoteEstimate,
  updateQuoteAnalysis,
  updateQuoteCustomer,
  updateQuoteStatus,
} from "../services/quotes";
import { getActiveConfiguration, saveNewPricingConfigurationVersion } from "../services/pricing";
import type { AuthSession } from "../auth/session";

const sampleInput = (windowCount = 18) => ({
  customer: { name: "Jordan Rivera", email: "jordan@example.com", phone: "(555) 000-1111" },
  property: { propertyType: "single-family" as const, stories: 2 },
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
      windowCount,
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
});

async function setUp(): Promise<{ db: ReturnType<typeof createTestDb>; session: AuthSession }> {
  const db = createTestDb();
  const { session } = await signUp(db, {
    businessName: "Sparkle Windows",
    ownerEmail: "owner@sparkle.example",
    password: "correct-horse-battery",
  });
  return { db, session };
}

describe("createQuote", () => {
  it("persists the quote with its customer, estimate, line items, total, status, and pricingConfigId", async () => {
    const { db, session } = await setUp();
    const configuration = getActiveConfiguration(db, session);

    const quote = createQuote(db, session, sampleInput());

    expect(quote.customer.name).toBe("Jordan Rivera");
    expect(quote.customer.email).toBe("jordan@example.com");
    expect(quote.customerId).toBe(quote.customer.id);
    expect(quote.estimate.total).toBeGreaterThan(0);
    expect(quote.estimate.lineItems.length).toBeGreaterThan(0);
    expect(quote.status).toBe("new");
    expect(quote.pricingConfigId).toBe(configuration.id);
  });

  it("finds an existing customer by email rather than creating a duplicate", async () => {
    const { db, session } = await setUp();
    const first = createQuote(db, session, sampleInput());
    const second = createQuote(db, session, sampleInput(20));

    expect(second.customerId).toBe(first.customerId);
  });

  it("is retrievable via getQuote and listQuotes after creation", async () => {
    const { db, session } = await setUp();
    const quote = createQuote(db, session, sampleInput());

    expect(getQuote(db, session, quote.id)).toEqual(quote);
    expect(listQuotes(db, session).map((q) => q.id)).toContain(quote.id);
  });

  it("computes the estimate through calculateEstimate — never accepts a client-supplied total", async () => {
    // CreateQuoteInput has no `estimate`/`total` field at all; this is really a type-level
    // guarantee, exercised here by confirming the persisted total matches an independent
    // recomputation from the same configuration and characteristics.
    const { db, session } = await setUp();
    const configuration = getActiveConfiguration(db, session);
    const quote = createQuote(db, session, sampleInput());

    const { calculateEstimate, reconcilePricingInput } = await import("@tallyvis/pricing");
    const expected = calculateEstimate(
      reconcilePricingInput(quote.servicePreferences, quote.analysis.characteristics),
      configuration,
      "high",
    );
    expect(quote.estimate).toEqual(expected);
  });
});

describe("pricing configuration versioning and historical integrity", () => {
  it("Quote A keeps referencing v1 after v2 is created, and a new Quote B references v2", async () => {
    const { db, session } = await setUp();
    const v1 = getActiveConfiguration(db, session);

    const quoteA = createQuote(db, session, sampleInput());
    expect(quoteA.pricingConfigId).toBe(v1.id);

    const v2 = saveNewPricingConfigurationVersion(db, session, { ...v1.rules, basePrice: v1.rules.basePrice + 25 });
    expect(v2.version).toBe(v1.version + 1);
    expect(v2.id).not.toBe(v1.id);

    const quoteB = createQuote(db, session, sampleInput(20));
    expect(quoteB.pricingConfigId).toBe(v2.id);

    // Quote A is completely unchanged by the new version existing.
    const reloadedA = getQuote(db, session, quoteA.id)!;
    expect(reloadedA.pricingConfigId).toBe(v1.id);
    expect(reloadedA.estimate).toEqual(quoteA.estimate);
  });

  it("updateQuoteAnalysis re-prices against the quote's PINNED configuration, not the current one", async () => {
    const { db, session } = await setUp();
    const v1 = getActiveConfiguration(db, session);
    const quote = createQuote(db, session, sampleInput());

    saveNewPricingConfigurationVersion(db, session, { ...v1.rules, basePrice: v1.rules.basePrice + 60 });

    const edited = updateQuoteAnalysis(db, session, quote.id, {
      ...quote.analysis.characteristics,
      windowCount: quote.analysis.characteristics.windowCount + 2,
    });

    expect(edited.pricingConfigId).toBe(v1.id);
  });

  it("recalculateQuoteEstimate explicitly re-prices against the CURRENT configuration and re-pins it", async () => {
    const { db, session } = await setUp();
    const v1 = getActiveConfiguration(db, session);
    const quote = createQuote(db, session, sampleInput());
    const originalTotal = quote.estimate.total;

    const v2 = saveNewPricingConfigurationVersion(db, session, { ...v1.rules, basePrice: v1.rules.basePrice + 40 });
    const multiplier = v1.rules.difficultyMultipliers[quote.analysis.characteristics.accessibility];

    const recalculated = recalculateQuoteEstimate(db, session, quote.id);

    expect(recalculated.pricingConfigId).toBe(v2.id);
    expect(recalculated.estimate.total).toBe(roundMoney(originalTotal + 40 * multiplier));
  });
});

describe("updateQuoteStatus", () => {
  it("persists an allowed transition", async () => {
    const { db, session } = await setUp();
    const quote = createQuote(db, session, sampleInput());
    const updated = updateQuoteStatus(db, session, quote.id, "approved");
    expect(updated.status).toBe("approved");
    expect(getQuote(db, session, quote.id)!.status).toBe("approved");
  });

  it("rejects a transition the status graph doesn't allow", async () => {
    const { db, session } = await setUp();
    const quote = createQuote(db, session, sampleInput());
    updateQuoteStatus(db, session, quote.id, "declined");

    expect(() => updateQuoteStatus(db, session, quote.id, "approved")).toThrow(
      /Cannot move a quote from "declined" to "approved"/,
    );
  });
});

describe("updateQuoteCustomer", () => {
  it("updates the shared customer record and never touches the estimate", async () => {
    const { db, session } = await setUp();
    const quote = createQuote(db, session, sampleInput());

    const updated = updateQuoteCustomer(db, session, quote.id, {
      name: "Jordan R.",
      email: "jordan.rivera@example.com",
      phone: "(555) 999-8888",
    });

    expect(updated.customer.name).toBe("Jordan R.");
    expect(updated.customer.email).toBe("jordan.rivera@example.com");
    expect(updated.estimate).toEqual(quote.estimate);
    expect(updated.pricingConfigId).toBe(quote.pricingConfigId);
  });
});
