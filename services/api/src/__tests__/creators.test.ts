import { describe, expect, it } from "vitest";
import { useTestDb } from "./testHarness";
import { signUp } from "../services/auth";
import {
  createCreatorAdmin,
  updateCreatorAdmin,
  linkCreatorBusinessAdmin,
  setCreatorComplimentaryAccessAdmin,
  hasComplimentaryAccess,
  listCreatorsAdmin,
  getCreatorDetailAdmin,
  markCommissionPaidAdmin,
} from "../services/creators";
import { attributeReferral } from "../services/creatorReferrals";
import { createCreatorCommission } from "../repositories/creatorCommissions";
import { createCreator } from "../repositories/creators";

const getDb = useTestDb();

async function newAdmin() {
  const db = getDb();
  const { session } = await signUp(db, {
    businessName: "Admin Co",
    ownerEmail: `admin-${Math.random()}@example.com`,
    password: "correct-horse-battery",
  });
  await db.query(`UPDATE users SET is_admin = TRUE WHERE id = $1`, [session.userId]);
  return { db, session };
}

async function newNonAdmin() {
  const db = getDb();
  const { session } = await signUp(db, {
    businessName: "Regular Co",
    ownerEmail: `regular-${Math.random()}@example.com`,
    password: "correct-horse-battery",
  });
  return { db, session };
}

describe("createCreatorAdmin", () => {
  it("creates a creator with program-default commission terms when none are supplied", async () => {
    const { db, session } = await newAdmin();
    const creator = await createCreatorAdmin(db, session, { slug: "ben", name: "Ben", email: "ben@example.com" });
    expect(creator.commissionRateBps).toBe(2000);
    expect(creator.commissionDurationMonths).toBe(12);
    expect(creator.status).toBe("prospect");
  });

  it("rejects a non-admin caller", async () => {
    const { db, session } = await newNonAdmin();
    await expect(createCreatorAdmin(db, session, { slug: "ben", name: "Ben", email: "ben@example.com" })).rejects.toThrow(
      /admin access required/i,
    );
  });

  it("rejects a malformed slug", async () => {
    const { db, session } = await newAdmin();
    await expect(createCreatorAdmin(db, session, { slug: "a", name: "Ben", email: "ben@example.com" })).rejects.toThrow(
      /referral code/i,
    );
  });

  it("rejects a duplicate slug", async () => {
    const { db, session } = await newAdmin();
    await createCreatorAdmin(db, session, { slug: "ben", name: "Ben", email: "ben@example.com" });
    await expect(
      createCreatorAdmin(db, session, { slug: "ben", name: "Someone Else", email: "else@example.com" }),
    ).rejects.toThrow(/already taken/i);
  });

  it("normalizes the slug to lowercase", async () => {
    const { db, session } = await newAdmin();
    const creator = await createCreatorAdmin(db, session, { slug: "BEN", name: "Ben", email: "ben@example.com" });
    expect(creator.slug).toBe("ben");
  });

  it("rejects an out-of-range commission rate", async () => {
    const { db, session } = await newAdmin();
    await expect(
      createCreatorAdmin(db, session, { slug: "ben", name: "Ben", email: "ben@example.com", commissionRateBps: 20_000 }),
    ).rejects.toThrow(/basis points/i);
  });
});

describe("updateCreatorAdmin", () => {
  it("updates fields, never the slug (not part of the update input type at all)", async () => {
    const { db, session } = await newAdmin();
    const creator = await createCreatorAdmin(db, session, { slug: "ben", name: "Ben", email: "ben@example.com" });

    const updated = await updateCreatorAdmin(db, session, creator.id, { commissionRateBps: 2500, status: "active" });
    expect(updated.commissionRateBps).toBe(2500);
    expect(updated.status).toBe("active");
    expect(updated.slug).toBe("ben");
  });

  it("rejects a non-admin caller", async () => {
    const { db: adminDb, session: adminSession } = await newAdmin();
    const creator = await createCreatorAdmin(adminDb, adminSession, { slug: "ben", name: "Ben", email: "ben@example.com" });

    const { db, session } = await newNonAdmin();
    await expect(updateCreatorAdmin(db, session, creator.id, { status: "active" })).rejects.toThrow(/admin access required/i);
  });
});

describe("linkCreatorBusinessAdmin / setCreatorComplimentaryAccessAdmin / hasComplimentaryAccess", () => {
  it("refuses to grant complimentary access with no linked business", async () => {
    const { db, session } = await newAdmin();
    const creator = await createCreatorAdmin(db, session, { slug: "ben", name: "Ben", email: "ben@example.com" });
    await expect(setCreatorComplimentaryAccessAdmin(db, session, creator.id, true)).rejects.toThrow(/link this creator/i);
  });

  it("links a business, grants complimentary access, and hasComplimentaryAccess becomes true only once both the link AND active status hold", async () => {
    const { db, session } = await newAdmin();
    const creator = await createCreatorAdmin(db, session, {
      slug: "ben",
      name: "Ben",
      email: "ben@example.com",
      status: "active",
    });
    const { session: ownBusiness } = await signUp(db, {
      businessName: "Ben's Window Co",
      ownerEmail: "bens-own-business@example.com",
      password: "correct-horse-battery",
    });

    await linkCreatorBusinessAdmin(db, session, creator.id, ownBusiness.businessId);
    expect(await hasComplimentaryAccess(db, ownBusiness.businessId)).toBe(false); // linked, but not yet granted

    await setCreatorComplimentaryAccessAdmin(db, session, creator.id, true);
    expect(await hasComplimentaryAccess(db, ownBusiness.businessId)).toBe(true);
  });

  it("suspends complimentary access immediately when the creator is paused, with no separate step", async () => {
    const { db, session } = await newAdmin();
    const creator = await createCreatorAdmin(db, session, {
      slug: "ben",
      name: "Ben",
      email: "ben@example.com",
      status: "active",
    });
    const { session: ownBusiness } = await signUp(db, {
      businessName: "Ben's Window Co",
      ownerEmail: "bens-own-business-2@example.com",
      password: "correct-horse-battery",
    });
    await linkCreatorBusinessAdmin(db, session, creator.id, ownBusiness.businessId);
    await setCreatorComplimentaryAccessAdmin(db, session, creator.id, true);
    expect(await hasComplimentaryAccess(db, ownBusiness.businessId)).toBe(true);

    await updateCreatorAdmin(db, session, creator.id, { status: "paused" });
    expect(await hasComplimentaryAccess(db, ownBusiness.businessId)).toBe(false);
  });

  it("refuses to link a business already linked to a different creator", async () => {
    const { db, session } = await newAdmin();
    const creatorA = await createCreatorAdmin(db, session, { slug: "ben", name: "Ben", email: "ben@example.com" });
    const creatorB = await createCreatorAdmin(db, session, { slug: "zara", name: "Zara", email: "zara@example.com" });
    const { session: theBusiness } = await signUp(db, {
      businessName: "Shared Co",
      ownerEmail: "shared-biz@example.com",
      password: "correct-horse-battery",
    });

    await linkCreatorBusinessAdmin(db, session, creatorA.id, theBusiness.businessId);
    await expect(linkCreatorBusinessAdmin(db, session, creatorB.id, theBusiness.businessId)).rejects.toThrow(
      /already linked to a different creator/i,
    );
  });

  it("unlinking (businessId: null) also clears complimentaryAccess — never left dangling", async () => {
    const { db, session } = await newAdmin();
    const creator = await createCreatorAdmin(db, session, {
      slug: "ben",
      name: "Ben",
      email: "ben@example.com",
      status: "active",
    });
    const { session: ownBusiness } = await signUp(db, {
      businessName: "Ben's Window Co",
      ownerEmail: "bens-own-business-3@example.com",
      password: "correct-horse-battery",
    });
    await linkCreatorBusinessAdmin(db, session, creator.id, ownBusiness.businessId);
    await setCreatorComplimentaryAccessAdmin(db, session, creator.id, true);

    const unlinked = await linkCreatorBusinessAdmin(db, session, creator.id, null);
    expect(unlinked.businessId).toBeUndefined();
    expect(unlinked.complimentaryAccess).toBe(false);
  });
});

describe("listCreatorsAdmin — metrics", () => {
  it("rejects a non-admin caller", async () => {
    const { db, session } = await newNonAdmin();
    await expect(listCreatorsAdmin(db, session)).rejects.toThrow(/admin access required/i);
  });

  it("counts clicks, signups, and sums commission totals across referrals", async () => {
    const { db, session } = await newAdmin();
    const creator = await createCreator(db, {
      slug: "ben",
      name: "Ben",
      email: "ben@example.com",
      platform: "",
      profileUrl: "",
      status: "active",
      commissionRateBps: 2000,
      commissionDurationMonths: 12,
      notes: "",
    });

    const { session: referred } = await signUp(db, {
      businessName: "Referred Co",
      ownerEmail: "referred-co@example.com",
      password: "correct-horse-battery",
    });
    const referral = (await attributeReferral(db, referred.businessId, {
      slug: "ben",
      firstObservedAt: new Date().toISOString(),
    }))!;

    await createCreatorCommission(db, {
      creatorId: creator.id,
      referralId: referral.id,
      businessId: referred.businessId,
      stripeInvoiceId: "in_test_1",
      collectedAmountCents: 10000,
      currency: "usd",
      commissionRateBps: 2000,
      commissionAmountCents: 2000,
    });

    const { rows, overview } = await listCreatorsAdmin(db, session);
    const row = rows.find((r) => r.id === creator.id)!;
    expect(row.signupCount).toBe(1);
    expect(row.commissionEarnedCents).toBe(2000);
    expect(row.commissionUnpaidCents).toBe(2000);
    expect(overview.totalCommissionUnpaidCents).toBeGreaterThanOrEqual(2000);
  });
});

describe("getCreatorDetailAdmin", () => {
  it("returns undefined for an unknown creator id", async () => {
    const { db, session } = await newAdmin();
    expect(await getCreatorDetailAdmin(db, session, "creator_does-not-exist")).toBeUndefined();
  });

  it("returns referred businesses and commissions scoped to exactly this creator", async () => {
    const { db, session } = await newAdmin();
    const creatorA = await createCreatorAdmin(db, session, { slug: "ben", name: "Ben", email: "ben@example.com", status: "active" });
    const creatorB = await createCreatorAdmin(db, session, { slug: "zara", name: "Zara", email: "zara@example.com", status: "active" });

    const { session: bizA } = await signUp(db, { businessName: "A Co", ownerEmail: "a-co@example.com", password: "correct-horse-battery" });
    const { session: bizB } = await signUp(db, { businessName: "B Co", ownerEmail: "b-co@example.com", password: "correct-horse-battery" });
    await attributeReferral(db, bizA.businessId, { slug: "ben", firstObservedAt: new Date().toISOString() });
    await attributeReferral(db, bizB.businessId, { slug: "zara", firstObservedAt: new Date().toISOString() });

    const detailA = await getCreatorDetailAdmin(db, session, creatorA.id);
    expect(detailA?.referrals).toHaveLength(1);
    expect(detailA?.referrals[0]!.businessName).toBe("A Co");

    const detailB = await getCreatorDetailAdmin(db, session, creatorB.id);
    expect(detailB?.referrals).toHaveLength(1);
    expect(detailB?.referrals[0]!.businessName).toBe("B Co");
  });
});

describe("markCommissionPaidAdmin", () => {
  it("marks an accrued commission paid, with an optional note", async () => {
    const { db, session } = await newAdmin();
    const creator = await createCreatorAdmin(db, session, { slug: "ben", name: "Ben", email: "ben@example.com", status: "active" });
    const { session: referred } = await signUp(db, { businessName: "Referred Co", ownerEmail: "r-co@example.com", password: "correct-horse-battery" });
    const referral = (await attributeReferral(db, referred.businessId, { slug: "ben", firstObservedAt: new Date().toISOString() }))!;
    const commission = await createCreatorCommission(db, {
      creatorId: creator.id,
      referralId: referral.id,
      businessId: referred.businessId,
      stripeInvoiceId: "in_test_paid",
      collectedAmountCents: 5000,
      currency: "usd",
      commissionRateBps: 2000,
      commissionAmountCents: 1000,
    });

    const paid = await markCommissionPaidAdmin(db, session, commission.id, "Paid via PayPal 10/2");
    expect(paid.status).toBe("paid");
    expect(paid.payoutNote).toBe("Paid via PayPal 10/2");
  });

  it("refuses to mark an already-paid commission paid again", async () => {
    const { db, session } = await newAdmin();
    const creator = await createCreatorAdmin(db, session, { slug: "ben", name: "Ben", email: "ben@example.com", status: "active" });
    const { session: referred } = await signUp(db, { businessName: "Referred Co", ownerEmail: "r-co-2@example.com", password: "correct-horse-battery" });
    const referral = (await attributeReferral(db, referred.businessId, { slug: "ben", firstObservedAt: new Date().toISOString() }))!;
    const commission = await createCreatorCommission(db, {
      creatorId: creator.id,
      referralId: referral.id,
      businessId: referred.businessId,
      stripeInvoiceId: "in_test_double_paid",
      collectedAmountCents: 5000,
      currency: "usd",
      commissionRateBps: 2000,
      commissionAmountCents: 1000,
    });
    await markCommissionPaidAdmin(db, session, commission.id, undefined);
    await expect(markCommissionPaidAdmin(db, session, commission.id, undefined)).rejects.toThrow(/not found|already/i);
  });

  it("rejects a non-admin caller", async () => {
    const { db, session } = await newNonAdmin();
    await expect(markCommissionPaidAdmin(db, session, "commission_whatever", undefined)).rejects.toThrow(/admin access required/i);
  });
});
