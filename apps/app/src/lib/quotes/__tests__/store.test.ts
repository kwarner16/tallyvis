import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateQuoteInput } from "../store";
import { roundMoney } from "@tallyvis/pricing";
import * as store from "../store";

/**
 * store.ts checks `typeof window === "undefined"` and reads/writes
 * `window.localStorage`. This stubs just enough of `window` to exercise the
 * real store against an in-memory backing store, the same technique used to
 * manually verify the fresh-state (no existing localStorage entry) path
 * during Phase 6 — formalized here as a real, repeatable test suite.
 */
function stubBrowserStorage() {
  const memory = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => (memory.has(key) ? memory.get(key)! : null),
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
      removeItem: (key: string) => {
        memory.delete(key);
      },
    },
  });
}

beforeEach(() => {
  stubBrowserStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const sampleQuoteInput: CreateQuoteInput = {
  customer: { name: "Jordan Rivera", email: "jordan@example.com" },
  property: { propertyType: "single-family", stories: 2 },
  servicePreferences: {
    interiorCleaning: false,
    screens: true,
    tracks: false,
    hardWaterTreatment: "unsure",
  },
  notes: "",
  photos: [],
  analysis: {
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
    metadata: { confidence: "high" },
  },
};

describe("getPricingConfiguration", () => {
  it("returns a seeded, valid configuration on first access (no prior localStorage entry)", () => {
    const configuration = store.getPricingConfiguration();
    expect(configuration.version).toBe(1);
    expect(configuration.rules.vertical).toBe("window-cleaning");
  });
});

describe("createQuote", () => {
  it("prices the quote through calculateEstimate and pins the active configuration's id", () => {
    const configuration = store.getPricingConfiguration();
    const quote = store.createQuote(sampleQuoteInput);

    expect(quote.pricingConfigId).toBe(configuration.id);
    expect(quote.estimate.total).toBeGreaterThan(0);
    expect(quote.estimate.currency).toBe(configuration.currency);
  });

  it("is persisted and retrievable via getQuote/listQuotes", () => {
    const quote = store.createQuote(sampleQuoteInput);

    expect(store.getQuote(quote.id)).toEqual(quote);
    expect(store.listQuotes().some((q) => q.id === quote.id)).toBe(true);
  });
});

describe("savePricingRules (versioning)", () => {
  it("creates a new version instead of mutating the current configuration", () => {
    const before = store.getPricingConfiguration();
    const saved = store.savePricingRules({ ...before.rules, basePrice: before.rules.basePrice + 20 });

    expect(saved.version).toBe(before.version + 1);
    expect(saved.id).not.toBe(before.id);
    expect(saved.rules.basePrice).toBe(before.rules.basePrice + 20);
  });

  it("becomes the new active configuration", () => {
    const before = store.getPricingConfiguration();
    const saved = store.savePricingRules({ ...before.rules, basePrice: before.rules.basePrice + 20 });

    expect(store.getPricingConfiguration()).toEqual(saved);
  });

  it("rejects an invalid rate card and leaves the active configuration unchanged", () => {
    const before = store.getPricingConfiguration();

    expect(() => store.savePricingRules({ ...before.rules, basePrice: -1 })).toThrow(
      /negative/,
    );
    expect(store.getPricingConfiguration()).toEqual(before);
  });

  it("does not retroactively change a quote already priced under the previous version", () => {
    const quote = store.createQuote(sampleQuoteInput);
    const originalConfigId = quote.pricingConfigId;
    const originalTotal = quote.estimate.total;

    const before = store.getPricingConfiguration();
    store.savePricingRules({ ...before.rules, basePrice: before.rules.basePrice + 100 });

    const reloaded = store.getQuote(quote.id)!;
    expect(reloaded.pricingConfigId).toBe(originalConfigId);
    expect(reloaded.estimate.total).toBe(originalTotal);
  });

  it("changes the total a newly created quote receives, scaled by the job's difficulty multiplier", () => {
    const before = store.getPricingConfiguration();
    const beforeQuote = store.createQuote(sampleQuoteInput);

    store.savePricingRules({ ...before.rules, basePrice: before.rules.basePrice + 50 });
    const afterQuote = store.createQuote(sampleQuoteInput);

    const multiplier =
      before.rules.difficultyMultipliers[sampleQuoteInput.analysis.characteristics.accessibility];
    expect(afterQuote.estimate.total).toBe(
      roundMoney(beforeQuote.estimate.total + 50 * multiplier),
    );
    expect(afterQuote.pricingConfigId).not.toBe(beforeQuote.pricingConfigId);
  });
});

describe("getPricingConfigurationById", () => {
  it("looks up the exact version a quote was priced under, even after newer versions exist", () => {
    const quote = store.createQuote(sampleQuoteInput);
    const original = store.getPricingConfiguration();

    store.savePricingRules({ ...original.rules, basePrice: original.rules.basePrice + 10 });

    const found = store.getPricingConfigurationById(quote.pricingConfigId);
    expect(found).toEqual(original);
  });

  it("returns undefined for an unknown id", () => {
    expect(store.getPricingConfigurationById("not-a-real-id")).toBeUndefined();
  });
});

describe("updateQuoteCustomer", () => {
  it("updates the customer without touching the estimate or pricingConfigId", () => {
    const quote = store.createQuote(sampleQuoteInput);

    const updated = store.updateQuoteCustomer(quote.id, {
      name: "Jordan R.",
      email: "jordan.rivera@example.com",
      phone: "(555) 000-1111",
    });

    expect(updated.customer).toEqual({
      name: "Jordan R.",
      email: "jordan.rivera@example.com",
      phone: "(555) 000-1111",
    });
    expect(updated.estimate).toEqual(quote.estimate);
    expect(updated.pricingConfigId).toBe(quote.pricingConfigId);
  });

  it("throws for a quote that doesn't exist", () => {
    expect(() =>
      store.updateQuoteCustomer("not-a-real-quote", { name: "X", email: "x@example.com" }),
    ).toThrow(/not found/);
  });
});

describe("updateQuoteStatus", () => {
  it("allows a transition the status graph permits", () => {
    const quote = store.createQuote(sampleQuoteInput);
    const updated = store.updateQuoteStatus(quote.id, "approved");
    expect(updated.status).toBe("approved");
  });

  it("rejects a transition the status graph doesn't permit", () => {
    const quote = store.createQuote(sampleQuoteInput);
    store.updateQuoteStatus(quote.id, "approved");
    store.updateQuoteStatus(quote.id, "sent");
    store.updateQuoteStatus(quote.id, "accepted");

    expect(() => store.updateQuoteStatus(quote.id, "declined")).toThrow(
      /Cannot move a quote from "accepted" to "declined"/,
    );
  });

  it("throws for a quote that doesn't exist", () => {
    expect(() => store.updateQuoteStatus("not-a-real-quote", "approved")).toThrow(/not found/);
  });
});

describe("updateQuoteAnalysis vs recalculateQuoteEstimate", () => {
  it("updateQuoteAnalysis re-prices against the quote's originally pinned configuration, not today's", () => {
    const quote = store.createQuote(sampleQuoteInput);
    const pinnedConfigId = quote.pricingConfigId;

    const before = store.getPricingConfiguration();
    store.savePricingRules({ ...before.rules, basePrice: before.rules.basePrice + 40 });

    const edited = store.updateQuoteAnalysis(quote.id, {
      ...quote.analysis.characteristics,
      windowCount: quote.analysis.characteristics.windowCount + 2,
    });

    expect(edited.pricingConfigId).toBe(pinnedConfigId);
  });

  it("recalculateQuoteEstimate explicitly opts the quote into the current active configuration", () => {
    const quote = store.createQuote(sampleQuoteInput);
    const originalConfigId = quote.pricingConfigId;
    const originalTotal = quote.estimate.total;

    const before = store.getPricingConfiguration();
    store.savePricingRules({ ...before.rules, basePrice: before.rules.basePrice + 40 });
    const active = store.getPricingConfiguration();

    const recalculated = store.recalculateQuoteEstimate(quote.id);

    const multiplier =
      before.rules.difficultyMultipliers[quote.analysis.characteristics.accessibility];
    expect(recalculated.pricingConfigId).toBe(active.id);
    expect(recalculated.pricingConfigId).not.toBe(originalConfigId);
    expect(recalculated.estimate.total).toBe(roundMoney(originalTotal + 40 * multiplier));
  });

  it("both throw for a quote that doesn't exist", () => {
    expect(() =>
      store.updateQuoteAnalysis("not-a-real-quote", sampleQuoteInput.analysis.characteristics),
    ).toThrow(/not found/);
    expect(() => store.recalculateQuoteEstimate("not-a-real-quote")).toThrow(/not found/);
  });
});
