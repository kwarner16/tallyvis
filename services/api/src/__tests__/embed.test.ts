import { describe, expect, it } from "vitest";
import { createTestDb } from "../db/client";
import { signUp } from "../services/auth";
import { getCurrentBusiness, resolveEmbedBusiness } from "../services/business";
import { getActiveConfigurationForBusiness } from "../services/pricing";
import { createQuotePublic } from "../services/quotes";

/**
 * Phase 14 — website-embed foundation (see
 * docs/decisions/0016-onboarding-billing-embed.md). `publicEmbedId` is the
 * one business identifier a browser is trusted to assert directly for the
 * public estimator — these tests exercise exactly that trust boundary:
 * correct resolution, cross-business isolation, and that an invalid id
 * resolves to nothing rather than falling back to some other business.
 */

async function setUpTwoBusinesses() {
  const db = createTestDb();
  const a = await signUp(db, { businessName: "Business A", ownerEmail: "a@example.com", password: "password-a1" });
  const b = await signUp(db, { businessName: "Business B", ownerEmail: "b@example.com", password: "password-b1" });
  return { db, sessionA: a.session, sessionB: b.session };
}

describe("resolveEmbedBusiness", () => {
  it("resolves the correct business for its own public embed id", async () => {
    const { db, sessionA } = await setUpTwoBusinesses();
    const businessA = getCurrentBusiness(db, sessionA);

    const resolved = resolveEmbedBusiness(db, businessA.publicEmbedId);
    expect(resolved?.id).toBe(businessA.id);
  });

  it("never resolves a different business's embed id to the wrong business — cross-business isolation", async () => {
    const { db, sessionA, sessionB } = await setUpTwoBusinesses();
    const businessA = getCurrentBusiness(db, sessionA);
    const businessB = getCurrentBusiness(db, sessionB);

    expect(businessA.publicEmbedId).not.toBe(businessB.publicEmbedId);
    expect(resolveEmbedBusiness(db, businessA.publicEmbedId)?.id).toBe(businessA.id);
    expect(resolveEmbedBusiness(db, businessB.publicEmbedId)?.id).toBe(businessB.id);
  });

  it("resolves an invalid/unknown embed identifier to undefined, never a fallback business", async () => {
    const { db } = await setUpTwoBusinesses();
    expect(resolveEmbedBusiness(db, "not-a-real-embed-id")).toBeUndefined();
    expect(resolveEmbedBusiness(db, "")).toBeUndefined();
  });

  it("does not trust the internal businessId as if it were the public embed id", async () => {
    const { db, sessionA } = await setUpTwoBusinesses();
    const businessA = getCurrentBusiness(db, sessionA);
    expect(businessA.publicEmbedId).not.toBe(businessA.id);
    expect(resolveEmbedBusiness(db, businessA.id)).toBeUndefined();
  });

  it("records that the embed was loaded (embedLastSeenAt) without exposing anything beyond the public Business shape", async () => {
    const { db, sessionA } = await setUpTwoBusinesses();
    const businessA = getCurrentBusiness(db, sessionA);
    expect(businessA.embedLastSeenAt).toBeUndefined();

    resolveEmbedBusiness(db, businessA.publicEmbedId);

    const after = getCurrentBusiness(db, sessionA);
    expect(after.embedLastSeenAt).toBeTruthy();
  });
});

describe("quote creation through the embedded estimator", () => {
  it("prices and creates a quote against the business resolved from the embed id, isolated from other tenants", async () => {
    const { db, sessionA, sessionB } = await setUpTwoBusinesses();
    const businessA = getCurrentBusiness(db, sessionA);
    const resolved = resolveEmbedBusiness(db, businessA.publicEmbedId)!;
    const configuration = getActiveConfigurationForBusiness(db, resolved.id);

    const quote = createQuotePublic(db, resolved.id, {
      customer: { name: "Embed Customer", email: "embed-customer@example.com" },
      property: { propertyType: "single-family", stories: 1 },
      servicePreferences: { interiorCleaning: false, screens: false, tracks: false, hardWaterTreatment: "unsure" },
      notes: "",
      photos: [],
      analysis: {
        characteristics: {
          vertical: "window-cleaning",
          windowCount: 12,
          windowType: "double-hung",
          paneCount: 0,
          stories: 1,
          screens: 0,
          tracks: 0,
          accessibility: "easy",
          condition: "good",
          hardWaterStaining: false,
          estimatedLaborHours: 1.2,
          interiorCleaning: false,
        },
        metadata: { confidence: "high" },
      },
    });

    expect(quote.businessId).toBe(businessA.id);
    expect(quote.pricingConfigId).toBe(configuration.id);

    // Business B never sees a quote created through Business A's embed.
    const { listQuotes } = await import("../services/quotes");
    expect(listQuotes(db, sessionB)).toHaveLength(0);
    expect(listQuotes(db, sessionA)).toHaveLength(1);
  });
});
