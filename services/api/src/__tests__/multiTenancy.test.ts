import { describe, expect, it } from "vitest";
import { createTestDb } from "../db/client";
import { signUp } from "../services/auth";
import { createQuote, getQuote, updateQuoteStatus } from "../services/quotes";
import { findOrCreateCustomer, getCustomer } from "../services/customers";
import { getActiveConfiguration, getConfigurationById, saveNewPricingConfigurationVersion } from "../services/pricing";
import { getCurrentBusiness } from "../services/business";

/**
 * The core Phase 9 requirement: Business A's session must never be able to
 * read or write Business B's data, and vice versa, no matter what id is
 * asked for. Every assertion here exercises the actual service-layer
 * authorization boundary (not a mocked check), against a real database.
 */

const sampleAnalysis = (overrides?: Partial<{ windowCount: number }>) => ({
  characteristics: {
    vertical: "window-cleaning" as const,
    windowCount: overrides?.windowCount ?? 15,
    windowType: "double-hung" as const,
    paneCount: 0,
    stories: 1,
    screens: 0,
    tracks: 0,
    accessibility: "easy" as const,
    condition: "good" as const,
    hardWaterStaining: false,
    estimatedLaborHours: 1.5,
    interiorCleaning: false,
  },
  metadata: { confidence: "high" as const },
});

const sampleServicePreferences = {
  interiorCleaning: false,
  screens: false,
  tracks: false,
  hardWaterTreatment: "unsure" as const,
};

async function setUpTwoBusinesses() {
  const db = createTestDb();
  const a = await signUp(db, { businessName: "Business A", ownerEmail: "a@example.com", password: "password-a1" });
  const b = await signUp(db, { businessName: "Business B", ownerEmail: "b@example.com", password: "password-b1" });
  return { db, sessionA: a.session, sessionB: b.session };
}

describe("cross-tenant isolation", () => {
  it("Business B cannot retrieve Business A's customer", async () => {
    const { db, sessionA, sessionB } = await setUpTwoBusinesses();
    const customerA = findOrCreateCustomer(db, sessionA, { name: "Alice", email: "alice@example.com" });

    expect(getCustomer(db, sessionA, customerA.id)).toBeDefined();
    expect(getCustomer(db, sessionB, customerA.id)).toBeUndefined();
  });

  it("Business B cannot retrieve or modify Business A's quote", async () => {
    const { db, sessionA, sessionB } = await setUpTwoBusinesses();
    const quoteA = createQuote(db, sessionA, {
      customer: { name: "Alice", email: "alice@example.com" },
      property: { propertyType: "single-family", stories: 1 },
      servicePreferences: sampleServicePreferences,
      notes: "",
      photos: [],
      analysis: sampleAnalysis(),
    });

    expect(getQuote(db, sessionA, quoteA.id)).toBeDefined();
    expect(getQuote(db, sessionB, quoteA.id)).toBeUndefined();

    // Same id, wrong session — must be rejected as if it doesn't exist, not silently allowed.
    expect(() => updateQuoteStatus(db, sessionB, quoteA.id, "approved")).toThrow(/not found/);

    // Confirm Business A's quote status was NOT changed by Business B's attempt.
    const reloaded = getQuote(db, sessionA, quoteA.id)!;
    expect(reloaded.status).toBe("new");
  });

  it("Business B cannot retrieve or modify Business A's pricing configuration", async () => {
    const { db, sessionA, sessionB } = await setUpTwoBusinesses();
    const configA = getActiveConfiguration(db, sessionA);

    expect(getConfigurationById(db, sessionA, configA.id)).toBeDefined();
    expect(getConfigurationById(db, sessionB, configA.id)).toBeUndefined();

    // Business B "saving pricing" only ever creates a new version of ITS OWN configuration.
    const configBBefore = getActiveConfiguration(db, sessionB);
    saveNewPricingConfigurationVersion(db, sessionB, { ...configBBefore.rules, basePrice: 999 });

    // Business A's active configuration is completely unaffected.
    expect(getActiveConfiguration(db, sessionA)).toEqual(configA);
  });

  it("each business only ever lists its own quotes and customers", async () => {
    const { db, sessionA, sessionB } = await setUpTwoBusinesses();
    createQuote(db, sessionA, {
      customer: { name: "Alice", email: "alice@example.com" },
      property: { propertyType: "single-family", stories: 1 },
      servicePreferences: sampleServicePreferences,
      notes: "",
      photos: [],
      analysis: sampleAnalysis(),
    });
    createQuote(db, sessionB, {
      customer: { name: "Bob", email: "bob@example.com" },
      property: { propertyType: "single-family", stories: 1 },
      servicePreferences: sampleServicePreferences,
      notes: "",
      photos: [],
      analysis: sampleAnalysis(),
    });

    const { listQuotes } = await import("../services/quotes");
    const quotesA = listQuotes(db, sessionA);
    const quotesB = listQuotes(db, sessionB);

    expect(quotesA).toHaveLength(1);
    expect(quotesB).toHaveLength(1);
    expect(quotesA[0]!.customer.name).toBe("Alice");
    expect(quotesB[0]!.customer.name).toBe("Bob");
  });

  it("a business can only resolve its own business record", async () => {
    const { db, sessionA, sessionB } = await setUpTwoBusinesses();
    const businessA = getCurrentBusiness(db, sessionA);
    const businessB = getCurrentBusiness(db, sessionB);

    expect(businessA.id).not.toBe(businessB.id);
    expect(businessA.name).toBe("Business A");
    expect(businessB.name).toBe("Business B");
  });
});

describe("unauthenticated access", () => {
  it("an invalid/expired session resolves to undefined, which every page must treat as signed-out", async () => {
    const db = createTestDb();
    const { resolveSession } = await import("../services/auth");
    expect(resolveSession(db, "forged-token-that-was-never-issued")).toBeUndefined();
  });
});
