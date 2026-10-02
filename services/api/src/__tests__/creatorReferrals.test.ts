import { describe, expect, it } from "vitest";
import { useTestDb } from "./testHarness";
import { createCreator, getCreatorBySlug } from "../repositories/creators";
import { signUp } from "../services/auth";
import { getCreatorReferralByBusinessId } from "../repositories/creatorReferrals";
import {
  resolveEligibleCreatorBySlug,
  recordReferralClick,
  attributeReferral,
  isValidSlugFormat,
  normalizeSlug,
} from "../services/creatorReferrals";

const getDb = useTestDb();

function creatorInput(overrides: Partial<Parameters<typeof createCreator>[1]> = {}) {
  return {
    slug: "ben",
    name: "Ben Window Guy",
    email: "ben@example.com",
    platform: "YouTube",
    profileUrl: "https://youtube.com/@ben",
    status: "active" as const,
    commissionRateBps: 2000,
    commissionDurationMonths: 12,
    notes: "",
    ...overrides,
  };
}

describe("isValidSlugFormat / normalizeSlug", () => {
  it("accepts a plain lowercase slug", () => {
    expect(isValidSlugFormat("ben")).toBe(true);
  });

  it("accepts hyphens and digits", () => {
    expect(isValidSlugFormat("ben-the-window-guy-2")).toBe(true);
  });

  it("is case-insensitive at the format-check level (normalized before storage/lookup)", () => {
    expect(isValidSlugFormat("BEN")).toBe(true);
    expect(normalizeSlug("BEN")).toBe("ben");
  });

  it("rejects a single character (too short)", () => {
    expect(isValidSlugFormat("b")).toBe(false);
  });

  it("rejects a leading hyphen", () => {
    expect(isValidSlugFormat("-ben")).toBe(false);
  });

  it("rejects spaces, slashes, and other punctuation (malformed/abuse attempts)", () => {
    expect(isValidSlugFormat("ben smith")).toBe(false);
    expect(isValidSlugFormat("ben/../etc")).toBe(false);
    expect(isValidSlugFormat("ben'; DROP TABLE creators;--")).toBe(false);
  });

  it("rejects an absurdly long value", () => {
    expect(isValidSlugFormat("b".repeat(50))).toBe(false);
  });
});

describe("resolveEligibleCreatorBySlug", () => {
  it("resolves a real, active creator", async () => {
    const db = getDb();
    const creator = await createCreator(db, creatorInput());
    const resolution = await resolveEligibleCreatorBySlug(db, "ben");
    expect(resolution).toEqual({ creatorId: creator.id, slug: "ben" });
  });

  it("is case-insensitive", async () => {
    const db = getDb();
    await createCreator(db, creatorInput());
    const resolution = await resolveEligibleCreatorBySlug(db, "BEN");
    expect(resolution?.slug).toBe("ben");
  });

  it("returns undefined for an unknown slug", async () => {
    const db = getDb();
    expect(await resolveEligibleCreatorBySlug(db, "nobody")).toBeUndefined();
  });

  it("returns undefined for a malformed slug, never querying the database for it", async () => {
    const db = getDb();
    expect(await resolveEligibleCreatorBySlug(db, "a")).toBeUndefined();
    expect(await resolveEligibleCreatorBySlug(db, "../etc/passwd")).toBeUndefined();
  });

  it.each(["prospect", "invited", "paused", "inactive"] as const)(
    "returns undefined for a real creator whose status is '%s' (not active)",
    async (status) => {
      const db = getDb();
      await createCreator(db, creatorInput({ status, slug: `status-${status}` }));
      expect(await resolveEligibleCreatorBySlug(db, `status-${status}`)).toBeUndefined();
    },
  );
});

describe("recordReferralClick", () => {
  it("increments the creator's click count atomically", async () => {
    const db = getDb();
    const creator = await createCreator(db, creatorInput());
    await recordReferralClick(db, creator.id);
    await recordReferralClick(db, creator.id);
    const reloaded = await getCreatorBySlug(db, "ben");
    expect(reloaded?.clickCount).toBe(2);
  });
});

describe("attributeReferral — durable, immutable attribution", () => {
  async function newBusiness() {
    const db = getDb();
    const { session } = await signUp(db, {
      businessName: "Sparkle Windows",
      ownerEmail: `owner-${Math.random()}@example.com`,
      password: "correct-horse-battery",
    });
    return { db, businessId: session.businessId };
  }

  it("persists attribution to the real, active creator the slug resolves to", async () => {
    const { db, businessId } = await newBusiness();
    const creator = await createCreator(db, creatorInput());

    const referral = await attributeReferral(db, businessId, { slug: "ben", firstObservedAt: new Date().toISOString() });

    expect(referral?.creatorId).toBe(creator.id);
    expect(referral?.businessId).toBe(businessId);
    const stored = await getCreatorReferralByBusinessId(db, businessId);
    expect(stored?.creatorId).toBe(creator.id);
  });

  it("does nothing when there is no pending referral", async () => {
    const { db, businessId } = await newBusiness();
    await attributeReferral(db, businessId, undefined);
    expect(await getCreatorReferralByBusinessId(db, businessId)).toBeUndefined();
  });

  it("does nothing for a slug that doesn't resolve to a real, active creator (e.g. the creator was deactivated after the click, before signup)", async () => {
    const { db, businessId } = await newBusiness();
    await createCreator(db, creatorInput({ status: "paused" }));

    await attributeReferral(db, businessId, { slug: "ben", firstObservedAt: new Date().toISOString() });
    expect(await getCreatorReferralByBusinessId(db, businessId)).toBeUndefined();
  });

  it("never overwrites an existing attribution — a second call for the same business is a safe no-op, even naming a different real creator", async () => {
    const { db, businessId } = await newBusiness();
    const first = await createCreator(db, creatorInput({ slug: "ben" }));
    await createCreator(db, creatorInput({ slug: "zara", email: "zara@example.com" }));

    await attributeReferral(db, businessId, { slug: "ben", firstObservedAt: new Date().toISOString() });
    await attributeReferral(db, businessId, { slug: "zara", firstObservedAt: new Date().toISOString() });

    const stored = await getCreatorReferralByBusinessId(db, businessId);
    expect(stored?.creatorId).toBe(first.id);
  });

  it("clamps an implausible firstObservedAt (future-dated, i.e. a tampered cookie) to now, rather than trusting it", async () => {
    const { db, businessId } = await newBusiness();
    await createCreator(db, creatorInput());
    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

    const referral = await attributeReferral(db, businessId, { slug: "ben", firstObservedAt: farFuture });
    expect(referral).toBeDefined();
    expect(Date.parse(referral!.firstObservedAt)).toBeLessThan(Date.parse(farFuture));
  });
});
