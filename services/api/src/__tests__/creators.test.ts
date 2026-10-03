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
  recordCreatorActivityAdmin,
  firstActivityMonthStart,
  isCommissionPayable,
} from "../services/creators";
import { attributeReferral } from "../services/creatorReferrals";
import { processInvoicePaid, processChargeRefunded } from "../services/creatorCommissions";
import { createCreatorCommission } from "../repositories/creatorCommissions";
import { createCreator } from "../repositories/creators";
import { upsertSubscription } from "../repositories/subscriptions";
import type { StripeInvoiceObject } from "../billing/types";

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

  it("refuses to link a business id that doesn't exist — the server-side guard against an arbitrary/tampered id, independent of whatever the UI allows an admin to type", async () => {
    const { db, session } = await newAdmin();
    const creator = await createCreatorAdmin(db, session, { slug: "ben", name: "Ben", email: "ben@example.com" });
    await expect(linkCreatorBusinessAdmin(db, session, creator.id, "business_does-not-exist")).rejects.toThrow(/not found/i);
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
      commissionableAmountCents: 10000,
      currency: "usd",
      commissionRateBps: 2000,
      commissionAmountCents: 2000,
    });

    const { rows, overview } = await listCreatorsAdmin(db, session);
    const row = rows.find((r) => r.id === creator.id)!;
    expect(row.signupCount).toBe(1);
    // Fresh commission, well within the 30-day holding period — "pending," not yet "payable."
    expect(row.pendingCommissionCents).toBe(2000);
    expect(row.payableCommissionCents).toBe(0);
    expect(overview.totalPendingCommissionCents).toBeGreaterThanOrEqual(2000);
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
      commissionableAmountCents: 5000,
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
      commissionableAmountCents: 5000,
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

describe("activation stamping (V1.1)", () => {
  it("stamps activatedAt the first time a creator is created already-active", async () => {
    const { db, session } = await newAdmin();
    const creator = await createCreatorAdmin(db, session, { slug: "ben", name: "Ben", email: "ben@example.com", status: "active" });
    expect(creator.activatedAt).toBeDefined();
  });

  it("does not stamp activatedAt for a creator created in a non-active status", async () => {
    const { db, session } = await newAdmin();
    const creator = await createCreatorAdmin(db, session, { slug: "ben", name: "Ben", email: "ben@example.com" });
    expect(creator.activatedAt).toBeUndefined();
  });

  it("stamps activatedAt the first time a creator's status is updated to active", async () => {
    const { db, session } = await newAdmin();
    const creator = await createCreatorAdmin(db, session, { slug: "ben", name: "Ben", email: "ben@example.com" });
    expect(creator.activatedAt).toBeUndefined();

    const activated = await updateCreatorAdmin(db, session, creator.id, { status: "active" });
    expect(activated.activatedAt).toBeDefined();
  });

  it("never moves activatedAt again across a later pause/reactivate cycle", async () => {
    const { db, session } = await newAdmin();
    const creator = await createCreatorAdmin(db, session, { slug: "ben", name: "Ben", email: "ben@example.com", status: "active" });
    const firstActivatedAt = creator.activatedAt;

    await updateCreatorAdmin(db, session, creator.id, { status: "paused" });
    const reactivated = await updateCreatorAdmin(db, session, creator.id, { status: "active" });
    expect(reactivated.activatedAt).toBe(firstActivatedAt);
  });
});

describe("firstActivityMonthStart (V1.1 — onboarding month)", () => {
  it("returns undefined when never activated", () => {
    expect(firstActivityMonthStart(undefined)).toBeUndefined();
  });

  it("is the first day of the NEXT calendar month after activation — the activation month itself has no requirement", () => {
    expect(firstActivityMonthStart("2026-01-28T12:00:00.000Z")).toBe("2026-02-01T00:00:00.000Z");
  });

  it("rolls over the year correctly for a December activation", () => {
    expect(firstActivityMonthStart("2026-12-05T00:00:00.000Z")).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("isCommissionPayable (V1.1 — payout holding period)", () => {
  const HOLD_MS = 30 * 24 * 60 * 60 * 1000; // CREATOR_PROGRAM_POLICY.payoutHoldingPeriodDays === 30

  it("is not payable while still within the holding period", () => {
    const now = Date.now();
    expect(isCommissionPayable({ status: "accrued", createdAt: new Date(now - 1000).toISOString() }, now)).toBe(false);
  });

  it("becomes payable once the holding period has fully elapsed", () => {
    const now = Date.now();
    expect(isCommissionPayable({ status: "accrued", createdAt: new Date(now - HOLD_MS - 1000).toISOString() }, now)).toBe(true);
  });

  it("is never payable for a paid or reversed commission, regardless of age", () => {
    const now = Date.now();
    const ancient = new Date(now - HOLD_MS * 10).toISOString();
    expect(isCommissionPayable({ status: "paid", createdAt: ancient }, now)).toBe(false);
    expect(isCommissionPayable({ status: "reversed", createdAt: ancient }, now)).toBe(false);
  });
});

describe("recordCreatorActivityAdmin (V1.1 — lightweight manual activity log)", () => {
  it("records the most recent qualifying content, admin-entered", async () => {
    const { db, session } = await newAdmin();
    const creator = await createCreatorAdmin(db, session, { slug: "ben", name: "Ben", email: "ben@example.com", status: "active" });

    const updated = await recordCreatorActivityAdmin(db, session, creator.id, {
      contentAt: "2026-10-01",
      contentUrl: "https://youtube.com/watch?v=abc123",
      note: "Full walkthrough video, affiliate link in description.",
    });

    expect(updated.lastQualifyingContentUrl).toBe("https://youtube.com/watch?v=abc123");
    expect(updated.lastQualifyingContentAt).toBeDefined();
    expect(updated.lastQualifyingContentNote).toContain("affiliate link");
  });

  it("rejects a missing content URL", async () => {
    const { db, session } = await newAdmin();
    const creator = await createCreatorAdmin(db, session, { slug: "ben", name: "Ben", email: "ben@example.com", status: "active" });
    await expect(
      recordCreatorActivityAdmin(db, session, creator.id, { contentAt: "2026-10-01", contentUrl: "" }),
    ).rejects.toThrow(/content url/i);
  });

  it("rejects a non-admin caller", async () => {
    const { db, session } = await newNonAdmin();
    await expect(
      recordCreatorActivityAdmin(db, session, "creator_whatever", { contentAt: "2026-10-01", contentUrl: "https://example.com" }),
    ).rejects.toThrow(/admin access required/i);
  });
});

describe("existing referrals keep earning after deactivation (V1.1 requirement #7)", () => {
  function invoice(overrides: Partial<StripeInvoiceObject> & { subscription: string }): StripeInvoiceObject {
    return {
      id: `in_${Math.random().toString(36).slice(2, 10)}`,
      amount_paid: 6900,
      currency: "usd",
      period_start: Math.floor(Date.now() / 1000),
      period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      ...overrides,
    };
  }

  it("a referral made while the creator was active keeps producing commissions after the creator is paused or deactivated", async () => {
    const { db, session } = await newAdmin();
    const creator = await createCreatorAdmin(db, session, { slug: "ben", name: "Ben", email: "ben@example.com", status: "active" });
    const { session: referred } = await signUp(db, {
      businessName: "Referred Co",
      ownerEmail: "referred-still-earning@example.com",
      password: "correct-horse-battery",
    });
    await attributeReferral(db, referred.businessId, { slug: "ben", firstObservedAt: new Date().toISOString() });
    const providerSubscriptionId = "sub_still_earning";
    await upsertSubscription(db, referred.businessId, { planId: "starter", status: "active", providerSubscriptionId });

    // First invoice while the creator is still active.
    await processInvoicePaid(db, invoice({ subscription: providerSubscriptionId, id: "in_while_active" }));

    // Kyle deactivates the creator — e.g. they missed their monthly content requirement.
    await updateCreatorAdmin(db, session, creator.id, { status: "inactive" });

    // A SECOND invoice, for the SAME existing referral, arrives after deactivation.
    const sixMonthsLater = Math.floor(Date.now() / 1000) + 180 * 24 * 60 * 60;
    await processInvoicePaid(
      db,
      invoice({ subscription: providerSubscriptionId, id: "in_after_deactivation", period_start: sixMonthsLater }),
    );

    const detail = await getCreatorDetailAdmin(db, session, creator.id);
    const invoiceIds = detail!.commissions.map((c) => c.stripeInvoiceId);
    expect(invoiceIds).toContain("in_while_active");
    expect(invoiceIds).toContain("in_after_deactivation");
  });

  it("deactivation blocks only NEW attribution — an unrelated business clicking the link after deactivation is never attributed", async () => {
    const { db, session } = await newAdmin();
    const creator = await createCreatorAdmin(db, session, { slug: "ben", name: "Ben", email: "ben@example.com", status: "active" });
    await updateCreatorAdmin(db, session, creator.id, { status: "inactive" });

    const { session: newBiz } = await signUp(db, {
      businessName: "New Business After Deactivation",
      ownerEmail: "new-after-deactivation@example.com",
      password: "correct-horse-battery",
    });
    const referral = await attributeReferral(db, newBiz.businessId, { slug: "ben", firstObservedAt: new Date().toISOString() });
    expect(referral).toBeUndefined();
  });

  it("deactivation ends complimentary access even though existing commission eligibility survives", async () => {
    const { db, session } = await newAdmin();
    const creator = await createCreatorAdmin(db, session, { slug: "ben", name: "Ben", email: "ben@example.com", status: "active" });
    const { session: ownBusiness } = await signUp(db, {
      businessName: "Ben's Window Co",
      ownerEmail: "bens-biz-deactivation@example.com",
      password: "correct-horse-battery",
    });
    await linkCreatorBusinessAdmin(db, session, creator.id, ownBusiness.businessId);
    await setCreatorComplimentaryAccessAdmin(db, session, creator.id, true);
    expect(await hasComplimentaryAccess(db, ownBusiness.businessId)).toBe(true);

    await updateCreatorAdmin(db, session, creator.id, { status: "inactive" });
    expect(await hasComplimentaryAccess(db, ownBusiness.businessId)).toBe(false);
  });
});

describe("admin financial totals correctly reflect reversals and adjustments (V1.1)", () => {
  function invoice(overrides: Partial<StripeInvoiceObject> & { subscription: string }): StripeInvoiceObject {
    return {
      id: `in_${Math.random().toString(36).slice(2, 10)}`,
      amount_paid: 10000,
      currency: "usd",
      period_start: Math.floor(Date.now() / 1000),
      period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      ...overrides,
    };
  }

  it("nets a partial reversal out of pendingCommissionCents for a still-accrued commission", async () => {
    const { db, session } = await newAdmin();
    await createCreatorAdmin(db, session, { slug: "ben", name: "Ben", email: "ben@example.com", status: "active" });
    const { session: referred } = await signUp(db, {
      businessName: "Referred Co",
      ownerEmail: "referred-partial-reversal@example.com",
      password: "correct-horse-battery",
    });
    await attributeReferral(db, referred.businessId, { slug: "ben", firstObservedAt: new Date().toISOString() });
    const providerSubscriptionId = "sub_partial_reversal";
    await upsertSubscription(db, referred.businessId, { planId: "starter", status: "active", providerSubscriptionId });

    await processInvoicePaid(
      db,
      invoice({ subscription: providerSubscriptionId, id: "in_admin_partial_reversal", charge: "ch_admin_partial_reversal" }),
    );
    // $25 of the $100 refunded -> $5 of the $20 commission reversed, net pending = $15.
    await processChargeRefunded(db, {
      id: "ch_admin_partial_reversal",
      invoice: "in_admin_partial_reversal",
      amount_refunded: 2500,
      refunded: false,
    });

    const { rows } = await listCreatorsAdmin(db, session);
    const row = rows.find((r) => r.slug === "ben")!;
    expect(row.pendingCommissionCents).toBe(1500);
  });

  it("surfaces a refund-after-payout adjustment in the creator's adjustmentCents total, without altering paidCommissionCents", async () => {
    const { db, session } = await newAdmin();
    await createCreatorAdmin(db, session, { slug: "zara", name: "Zara", email: "zara@example.com", status: "active" });
    const { session: referred } = await signUp(db, {
      businessName: "Referred Co 2",
      ownerEmail: "referred-paid-reversal@example.com",
      password: "correct-horse-battery",
    });
    await attributeReferral(db, referred.businessId, { slug: "zara", firstObservedAt: new Date().toISOString() });
    const providerSubscriptionId = "sub_paid_reversal";
    await upsertSubscription(db, referred.businessId, { planId: "starter", status: "active", providerSubscriptionId });

    await processInvoicePaid(
      db,
      invoice({ subscription: providerSubscriptionId, id: "in_admin_paid_reversal", charge: "ch_admin_paid_reversal" }),
    );
    const commission = await db
      .query<{ id: string }>(`SELECT id FROM creator_commissions WHERE stripe_invoice_id = $1`, ["in_admin_paid_reversal"])
      .then((r) => r.rows[0]!);
    await markCommissionPaidAdmin(db, session, commission.id, "Paid in October batch");

    await processChargeRefunded(db, {
      id: "ch_admin_paid_reversal",
      invoice: "in_admin_paid_reversal",
      amount_refunded: 2500,
      refunded: false,
    });

    const { rows } = await listCreatorsAdmin(db, session);
    const row = rows.find((r) => r.slug === "zara")!;
    expect(row.paidCommissionCents).toBe(2000); // the historical paid row is never rewritten.
    expect(row.adjustmentCents).toBe(-500); // but the ledger records the $5 owed back.
  });
});
