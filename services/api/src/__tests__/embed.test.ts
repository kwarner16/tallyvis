import { describe, expect, it } from "vitest";
import { deriveEstimatorTheme } from "@tallyvis/config";
import { useTestDb } from "./testHarness";
import { signUp } from "../services/auth";
import {
  getCurrentBusiness,
  resolveEmbedBusiness,
  resolvePublicBusinessSummary,
  updateCurrentBusiness,
} from "../services/business";
import { getActiveConfigurationForBusiness } from "../services/pricing";
import { createQuotePublic, listQuotes } from "../services/quotes";

const getDb = useTestDb();

/**
 * Phase 14 — website-embed foundation (see
 * docs/decisions/0016-onboarding-billing-embed.md). `publicEmbedId` is the
 * one business identifier a browser is trusted to assert directly for the
 * public estimator — these tests exercise exactly that trust boundary:
 * correct resolution, cross-business isolation, and that an invalid id
 * resolves to nothing rather than falling back to some other business.
 */

async function setUpTwoBusinesses() {
  const db = getDb();
  const a = await signUp(db, { businessName: "Business A", ownerEmail: "a@example.com", password: "password-a1" });
  const b = await signUp(db, { businessName: "Business B", ownerEmail: "b@example.com", password: "password-b1" });
  return { db, sessionA: a.session, sessionB: b.session };
}

describe("resolveEmbedBusiness", () => {
  it("resolves the correct business for its own public embed id", async () => {
    const { db, sessionA } = await setUpTwoBusinesses();
    const businessA = await getCurrentBusiness(db, sessionA);

    const resolved = await resolveEmbedBusiness(db, businessA.publicEmbedId);
    expect(resolved?.id).toBe(businessA.id);
  });

  it("never resolves a different business's embed id to the wrong business — cross-business isolation", async () => {
    const { db, sessionA, sessionB } = await setUpTwoBusinesses();
    const businessA = await getCurrentBusiness(db, sessionA);
    const businessB = await getCurrentBusiness(db, sessionB);

    expect(businessA.publicEmbedId).not.toBe(businessB.publicEmbedId);
    expect((await resolveEmbedBusiness(db, businessA.publicEmbedId))?.id).toBe(businessA.id);
    expect((await resolveEmbedBusiness(db, businessB.publicEmbedId))?.id).toBe(businessB.id);
  });

  it("resolves an invalid/unknown embed identifier to undefined, never a fallback business", async () => {
    const { db } = await setUpTwoBusinesses();
    expect(await resolveEmbedBusiness(db, "not-a-real-embed-id")).toBeUndefined();
    expect(await resolveEmbedBusiness(db, "")).toBeUndefined();
  });

  it("does not trust the internal businessId as if it were the public embed id", async () => {
    const { db, sessionA } = await setUpTwoBusinesses();
    const businessA = await getCurrentBusiness(db, sessionA);
    expect(businessA.publicEmbedId).not.toBe(businessA.id);
    expect(await resolveEmbedBusiness(db, businessA.id)).toBeUndefined();
  });

  it("records that the embed was loaded (embedLastSeenAt) without exposing anything beyond the public Business shape", async () => {
    const { db, sessionA } = await setUpTwoBusinesses();
    const businessA = await getCurrentBusiness(db, sessionA);
    expect(businessA.embedLastSeenAt).toBeUndefined();

    await resolveEmbedBusiness(db, businessA.publicEmbedId);

    const after = await getCurrentBusiness(db, sessionA);
    expect(after.embedLastSeenAt).toBeTruthy();
  });
});

describe("resolvePublicBusinessSummary — over-exposure regression (same bug class as quoteSharing's PublicBusinessSummary, see docs/decisions/0012)", () => {
  it("never includes the owner's email, internal id, or createdAt — only what the public estimator result page renders", async () => {
    const { db, sessionA } = await setUpTwoBusinesses();
    const businessA = await getCurrentBusiness(db, sessionA);

    const summary = await resolvePublicBusinessSummary(db, businessA.publicEmbedId);

    expect(summary).toEqual({
      name: businessA.name,
      phone: businessA.phone,
      logoUrl: businessA.logoUrl,
      brandColor: businessA.brandColor,
    });
    expect(summary).not.toHaveProperty("email");
    expect(summary).not.toHaveProperty("id");
    expect(summary).not.toHaveProperty("createdAt");
    expect(summary).not.toHaveProperty("publicEmbedId");
  });

  it("resolves to undefined when no embed id is given — no dangerous default-business fallback (2026-09 incident, docs/decisions/0027: the direct un-embedded /estimate wizard has no real business relationship at all, so this must never silently resolve to an arbitrary real business)", async () => {
    const { db } = await setUpTwoBusinesses();
    expect(await resolvePublicBusinessSummary(db)).toBeUndefined();
    expect(await resolvePublicBusinessSummary(db, undefined)).toBeUndefined();
  });

  it("resolves to undefined for an unknown embed id, never a fallback business's data", async () => {
    const { db } = await setUpTwoBusinesses();
    expect(await resolvePublicBusinessSummary(db, "not-a-real-embed-id")).toBeUndefined();
  });
});

describe("estimator branding — per-business brand color through the embed (Part 20 scenario: a blue-branded business alongside an orange-branded one)", () => {
  it("resolves each business's own brand color, isolated from the other tenant", async () => {
    const { db, sessionA, sessionB } = await setUpTwoBusinesses();

    const blueBusiness = await updateCurrentBusiness(db, sessionA, {
      name: "Business A",
      email: "a@example.com",
      phone: "",
      serviceArea: "",
      brandColor: "#0057b8",
    });
    const orangeBusiness = await updateCurrentBusiness(db, sessionB, {
      name: "Business B",
      email: "b@example.com",
      phone: "",
      serviceArea: "",
      brandColor: "#F97316",
    });

    const blueSummary = await resolvePublicBusinessSummary(db, blueBusiness.publicEmbedId);
    const orangeSummary = await resolvePublicBusinessSummary(db, orangeBusiness.publicEmbedId);

    expect(blueSummary?.brandColor).toBe("#0057B8");
    expect(orangeSummary?.brandColor).toBe("#F97316");

    // Resolving one business's embed id never leaks the other's branding.
    expect(blueSummary?.brandColor).not.toBe(orangeSummary?.brandColor);
    expect(blueSummary?.name).not.toBe(orangeSummary?.name);
  });

  it("derives visually distinct, correctly-contrasted estimator themes for each business's brand color", async () => {
    const { db, sessionA, sessionB } = await setUpTwoBusinesses();

    const blueBusiness = await updateCurrentBusiness(db, sessionA, {
      name: "Business A",
      email: "a@example.com",
      phone: "",
      serviceArea: "",
      brandColor: "#0057b8",
    });
    const orangeBusiness = await updateCurrentBusiness(db, sessionB, {
      name: "Business B",
      email: "b@example.com",
      phone: "",
      serviceArea: "",
      brandColor: "#F97316",
    });

    const blueSummary = await resolvePublicBusinessSummary(db, blueBusiness.publicEmbedId);
    const orangeSummary = await resolvePublicBusinessSummary(db, orangeBusiness.publicEmbedId);

    const blueTheme = deriveEstimatorTheme(blueSummary?.brandColor);
    const orangeTheme = deriveEstimatorTheme(orangeSummary?.brandColor);

    expect(blueTheme).not.toBeNull();
    expect(orangeTheme).not.toBeNull();
    expect(blueTheme!["--color-accent-strong"]).toBe("#0057B8");
    expect(orangeTheme!["--color-accent-strong"]).toBe("#F97316");
    expect(blueTheme!["--color-accent-strong"]).not.toBe(orangeTheme!["--color-accent-strong"]);
    // A dark, saturated blue and a mid-tone orange land on opposite sides of the white/near-black foreground choice.
    expect(blueTheme!["--color-accent-foreground"]).toBe("#FFFFFF");
    expect(orangeTheme!["--color-accent-foreground"]).toBe("#111111");
  });

  it("a business with no brand color set falls back to the default (undefined) theme, not a broken one", async () => {
    const { db, sessionA } = await setUpTwoBusinesses();
    const business = await getCurrentBusiness(db, sessionA);
    expect(business.brandColor).toBeUndefined();

    const summary = await resolvePublicBusinessSummary(db, business.publicEmbedId);
    expect(deriveEstimatorTheme(summary?.brandColor)).toBeNull();
  });
});

describe("quote creation through the embedded estimator", () => {
  it("prices and creates a quote against the business resolved from the embed id, isolated from other tenants", async () => {
    const { db, sessionA, sessionB } = await setUpTwoBusinesses();
    const businessA = await getCurrentBusiness(db, sessionA);
    const resolved = (await resolveEmbedBusiness(db, businessA.publicEmbedId))!;
    const configuration = await getActiveConfigurationForBusiness(db, resolved.id);

    const quote = await createQuotePublic(db, resolved.id, {
      customer: { name: "Embed Customer", email: "embed-customer@example.com" },
      property: { propertyType: "single-family", stories: 1, address: "1 Test St" },
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
    expect(await listQuotes(db, sessionB)).toHaveLength(0);
    expect(await listQuotes(db, sessionA)).toHaveLength(1);
  });
});
