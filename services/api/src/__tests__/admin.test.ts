import { describe, expect, it } from "vitest";
import { PLANS } from "@tallyvis/config";
import { useTestDb } from "./testHarness";
import { signUp } from "../services/auth";
import { createQuote, updateQuoteStatus } from "../services/quotes";
import { hasProductAccess } from "../services/subscriptions";
import { setUserIsAdmin } from "../repositories/users";
import { upsertSubscription, getSubscriptionByBusinessId } from "../repositories/subscriptions";
import { createBillingCharge } from "../repositories/billingCharges";
import {
  getAdminOverview,
  listBusinessesAdmin,
  getBusinessDetailAdmin,
  listSubscriptionsAdmin,
  listRecentActivityAdmin,
  calculateMrrBreakdown,
  isSubscriptionPastDue,
} from "../services/admin";

const getDb = useTestDb();

/**
 * Internal TallyVis CEO/Admin dashboard coverage (see
 * docs/decisions/0035-admin-dashboard.md). Mirrors `multiTenancy.test.ts`'s
 * approach — every assertion exercises the real service-layer
 * authorization boundary and real cross-tenant reads against a real
 * database, never a mocked check.
 */

const starterPriceCents = PLANS.find((plan) => plan.id === "starter")!.monthlyPriceCents;
const growthPriceCents = PLANS.find((plan) => plan.id === "growth")!.monthlyPriceCents;

const sampleQuoteInput = () => ({
  customer: { name: "Jordan Rivera", email: "jordan@example.com" },
  property: { propertyType: "single-family" as const, stories: 1, address: "1 Test St" },
  servicePreferences: { interiorCleaning: false, screens: false, tracks: false, hardWaterTreatment: "unsure" as const },
  notes: "",
  photos: [],
  analysis: {
    characteristics: {
      vertical: "window-cleaning" as const,
      windowCount: 15,
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
  },
});

async function createBusiness(name: string, email: string) {
  const db = getDb();
  const { session } = await signUp(db, { businessName: name, ownerEmail: email, password: "correct-horse-battery" });
  return session;
}

async function makeAdmin(userId: string) {
  await setUserIsAdmin(getDb(), userId, true);
}

describe("isAdminSession", () => {
  it("a normal signed-up user is not an admin by default", async () => {
    const session = await createBusiness("Normal Co", "normal@example.com");
    const overview = getAdminOverview(getDb(), session);
    await expect(overview).rejects.toThrow(/admin access required/i);
  });

  it("becomes an admin the moment users.is_admin is set — no need to log out and back in, since every check re-reads the database", async () => {
    const session = await createBusiness("Soon Admin Co", "soon-admin@example.com");
    await expect(getAdminOverview(getDb(), session)).rejects.toThrow(/admin access required/i);

    await makeAdmin(session.userId);
    await expect(getAdminOverview(getDb(), session)).resolves.toBeDefined();
  });
});

describe("admin service authorization — enforced independently of the UI", () => {
  it("every admin service function rejects a normal, authenticated, non-admin session", async () => {
    const normalSession = await createBusiness("Just A Customer Co", "customer@example.com");
    const db = getDb();

    await expect(getAdminOverview(db, normalSession)).rejects.toThrow(/admin access required/i);
    await expect(listBusinessesAdmin(db, normalSession, {})).rejects.toThrow(/admin access required/i);
    await expect(getBusinessDetailAdmin(db, normalSession, normalSession.businessId)).rejects.toThrow(
      /admin access required/i,
    );
    await expect(listSubscriptionsAdmin(db, normalSession)).rejects.toThrow(/admin access required/i);
    await expect(listRecentActivityAdmin(db, normalSession)).rejects.toThrow(/admin access required/i);
  });

  it("a normal customer cannot use their own session to read another business's admin detail", async () => {
    const attacker = await createBusiness("Attacker Co", "attacker@example.com");
    const victim = await createBusiness("Victim Co", "victim@example.com");
    const db = getDb();

    // Not an admin at all — rejected before the target business id even matters.
    await expect(getBusinessDetailAdmin(db, attacker, victim.businessId)).rejects.toThrow(/admin access required/i);
  });
});

describe("isSubscriptionPastDue", () => {
  it("is false when providerStatus is unknown (never guesses a fact we don't have)", () => {
    expect(isSubscriptionPastDue({ status: "active", providerStatus: undefined })).toBe(false);
  });

  it("is true only when status is active AND Stripe's raw status is confirmed past_due", () => {
    expect(isSubscriptionPastDue({ status: "active", providerStatus: "past_due" })).toBe(true);
  });

  it("is false for a trialing subscription even if providerStatus were somehow 'past_due' (status gates this first)", () => {
    expect(isSubscriptionPastDue({ status: "trialing", providerStatus: "past_due" })).toBe(false);
  });
});

describe("calculateMrrBreakdown", () => {
  it("counts a clean active subscription toward activeMrrCents, at its plan's authoritative price", () => {
    const breakdown = calculateMrrBreakdown([
      { status: "active", planId: "starter", providerStatus: "active" },
      { status: "active", planId: "growth", providerStatus: "active" },
    ]);
    expect(breakdown.activeMrrCents).toBe(starterPriceCents + growthPriceCents);
    expect(breakdown.pastDueMrrCents).toBe(0);
  });

  it("moves a Stripe-confirmed past_due subscription OUT of activeMrrCents and into pastDueMrrCents", () => {
    const breakdown = calculateMrrBreakdown([
      { status: "active", planId: "growth", providerStatus: "past_due" },
    ]);
    expect(breakdown.activeMrrCents).toBe(0);
    expect(breakdown.pastDueMrrCents).toBe(growthPriceCents);
  });

  it("treats an active subscription with an unknown (not-yet-synced) providerStatus as clean — never fabricates past_due", () => {
    const breakdown = calculateMrrBreakdown([{ status: "active", planId: "growth", providerStatus: undefined }]);
    expect(breakdown.activeMrrCents).toBe(growthPriceCents);
    expect(breakdown.pastDueMrrCents).toBe(0);
  });

  it("excludes trialing — Stripe isn't charging yet", () => {
    const breakdown = calculateMrrBreakdown([{ status: "trialing", planId: "growth", providerStatus: "trialing" }]);
    expect(breakdown.activeMrrCents).toBe(0);
    expect(breakdown.pastDueMrrCents).toBe(0);
  });

  it("excludes canceled — never counts a canceled subscription as active or past-due MRR", () => {
    const breakdown = calculateMrrBreakdown([{ status: "canceled", planId: "growth", providerStatus: "canceled" }]);
    expect(breakdown.activeMrrCents).toBe(0);
    expect(breakdown.pastDueMrrCents).toBe(0);
  });

  it("excludes expired and incomplete", () => {
    const breakdown = calculateMrrBreakdown([
      { status: "expired", planId: "pro", providerStatus: "unpaid" },
      { status: "incomplete", planId: "pro", providerStatus: "incomplete" },
    ]);
    expect(breakdown.activeMrrCents).toBe(0);
    expect(breakdown.pastDueMrrCents).toBe(0);
  });

  it("sums correctly across a realistic mixed set, splitting active from past-due", () => {
    const breakdown = calculateMrrBreakdown([
      { status: "active", planId: "starter", providerStatus: "active" },
      { status: "active", planId: "starter", providerStatus: "past_due" },
      { status: "trialing", planId: "pro", providerStatus: "trialing" },
      { status: "canceled", planId: "growth", providerStatus: "canceled" },
      { status: "incomplete", planId: "pro", providerStatus: "incomplete" },
    ]);
    expect(breakdown.activeMrrCents).toBe(starterPriceCents);
    expect(breakdown.pastDueMrrCents).toBe(starterPriceCents);
  });
});

describe("MRR excludes one-time charges", () => {
  it("a paid one-time installation fee never inflates MRR — billing_charges is a separate table calculateMrrBreakdown never reads", async () => {
    const admin = await createBusiness("Admin HQ", "mrr-admin@example.com");
    await makeAdmin(admin.userId);
    const paying = await createBusiness("Paying Customer Co", "paying@example.com");
    const db = getDb();

    await upsertSubscription(db, paying.businessId, { planId: "growth", status: "active", providerStatus: "active" });
    await createBillingCharge(db, paying.businessId, {
      kind: "website_installation",
      amountCents: 29900,
      currency: "USD",
      status: "paid",
    });

    const overview = await getAdminOverview(db, admin);
    expect(overview.mrr.activeMrrCents).toBe(growthPriceCents);
    expect(overview.mrr.pastDueMrrCents).toBe(0);
  });
});

describe("past_due billing status — distinguishable from active, entitlement preserved", () => {
  it("a Stripe-confirmed past_due subscription is reported as past_due by the admin overview, while still being internally 'active' for entitlement", async () => {
    const admin = await createBusiness("PastDue Admin Co", "pastdue-admin@example.com");
    await makeAdmin(admin.userId);
    const delinquent = await createBusiness("Delinquent Co", "delinquent@example.com");
    const db = getDb();

    await upsertSubscription(db, delinquent.businessId, {
      planId: "pro",
      status: "active",
      providerStatus: "past_due",
    });

    const overview = await getAdminOverview(db, admin);
    expect(overview.subscriptions.pastDue).toBe(1);
    expect(overview.subscriptions.active).toBe(0);
    expect(overview.mrr.pastDueMrrCents).toBe(PLANS.find((p) => p.id === "pro")!.monthlyPriceCents);
    expect(overview.mrr.activeMrrCents).toBe(0);

    // The entitlement gate is completely untouched by this: internal status
    // is still "active", so product access is preserved during dunning —
    // this is the existing, intentional policy (see hasProductAccess's own
    // comment), not a regression this fix introduced.
    const subscription = await getSubscriptionByBusinessId(db, delinquent.businessId);
    expect(subscription?.status).toBe("active");
    expect(hasProductAccess(subscription)).toBe(true);
  });

  it("a clean, current active subscription is still reported as active, not past_due", async () => {
    const admin = await createBusiness("Clean Admin Co", "clean-admin@example.com");
    await makeAdmin(admin.userId);
    const current = await createBusiness("Current Co", "current@example.com");
    const db = getDb();

    await upsertSubscription(db, current.businessId, { planId: "growth", status: "active", providerStatus: "active" });

    const overview = await getAdminOverview(db, admin);
    expect(overview.subscriptions.active).toBe(1);
    expect(overview.subscriptions.pastDue).toBe(0);
  });

  it("canceled remains distinguishable", async () => {
    const admin = await createBusiness("Canceled Admin Co", "canceled-admin@example.com");
    await makeAdmin(admin.userId);
    const canceledBiz = await createBusiness("Canceled Biz Co", "canceled-biz@example.com");
    const db = getDb();

    await upsertSubscription(db, canceledBiz.businessId, {
      planId: "growth",
      status: "canceled",
      providerStatus: "canceled",
      canceledAt: new Date().toISOString(),
    });

    const overview = await getAdminOverview(db, admin);
    expect(overview.subscriptions.canceled).toBe(1);
    expect(overview.subscriptions.active).toBe(0);
    expect(overview.subscriptions.pastDue).toBe(0);
  });

  it("trialing remains distinguishable", async () => {
    const admin = await createBusiness("Trialing Admin Co", "trialing-admin@example.com");
    await makeAdmin(admin.userId);
    const trialingBiz = await createBusiness("Trialing Biz Co", "trialing-biz@example.com");
    const db = getDb();

    await upsertSubscription(db, trialingBiz.businessId, {
      planId: "starter",
      status: "trialing",
      providerStatus: "trialing",
    });

    const overview = await getAdminOverview(db, admin);
    expect(overview.subscriptions.trialing).toBe(1);
    expect(overview.subscriptions.active).toBe(0);
    expect(overview.subscriptions.pastDue).toBe(0);
  });
});

describe("listBusinessesAdmin — cross-tenant visibility and pagination", () => {
  it("an admin sees every business, not just their own", async () => {
    const admin = await createBusiness("Admin HQ Co", "list-admin@example.com");
    await makeAdmin(admin.userId);
    await createBusiness("Alpha Windows", "alpha@example.com");
    await createBusiness("Beta Windows", "beta@example.com");
    const db = getDb();

    const result = await listBusinessesAdmin(db, admin, { pageSize: 50 });
    const names = result.rows.map((row) => row.name);
    expect(names).toContain("Admin HQ Co");
    expect(names).toContain("Alpha Windows");
    expect(names).toContain("Beta Windows");
    expect(result.total).toBe(3);
  });

  it("search filters by business name or owner email", async () => {
    const admin = await createBusiness("Search Admin Co", "search-admin@example.com");
    await makeAdmin(admin.userId);
    await createBusiness("Crystal Clear Windows", "crystal@example.com");
    await createBusiness("Shiny Panes LLC", "shiny@example.com");
    const db = getDb();

    const byName = await listBusinessesAdmin(db, admin, { search: "Crystal" });
    expect(byName.rows.map((row) => row.name)).toEqual(["Crystal Clear Windows"]);

    const byEmail = await listBusinessesAdmin(db, admin, { search: "shiny@example.com" });
    expect(byEmail.rows.map((row) => row.name)).toEqual(["Shiny Panes LLC"]);
  });

  it("paginates with a stable total across pages", async () => {
    const admin = await createBusiness("Page Admin Co", "page-admin@example.com");
    await makeAdmin(admin.userId);
    await createBusiness("Page Biz 1", "page1@example.com");
    await createBusiness("Page Biz 2", "page2@example.com");
    const db = getDb();

    const page1 = await listBusinessesAdmin(db, admin, { pageSize: 1, page: 1, sortBy: "name", sortDirection: "asc" });
    const page2 = await listBusinessesAdmin(db, admin, { pageSize: 1, page: 2, sortBy: "name", sortDirection: "asc" });

    expect(page1.total).toBe(3);
    expect(page2.total).toBe(3);
    expect(page1.rows).toHaveLength(1);
    expect(page2.rows).toHaveLength(1);
    expect(page1.rows[0]!.id).not.toBe(page2.rows[0]!.id);
  });
});

describe("getBusinessDetailAdmin — cross-tenant isolation in the admin view itself", () => {
  it("business A's detail counts never include business B's quotes or customers", async () => {
    const admin = await createBusiness("Detail Admin Co", "detail-admin@example.com");
    await makeAdmin(admin.userId);
    const a = await createBusiness("Business A", "a@example.com");
    const b = await createBusiness("Business B", "b@example.com");
    const db = getDb();

    await createQuote(db, a, sampleQuoteInput());
    await createQuote(db, b, sampleQuoteInput());
    await createQuote(db, b, sampleQuoteInput());

    const detailA = await getBusinessDetailAdmin(db, admin, a.businessId);
    const detailB = await getBusinessDetailAdmin(db, admin, b.businessId);

    expect(detailA?.quoteCount).toBe(1);
    expect(detailB?.quoteCount).toBe(2);
    expect(detailA?.business.id).toBe(a.businessId);
  });

  it("correctly counts accepted and declined quotes for the inspected business only", async () => {
    const admin = await createBusiness("Status Admin Co", "status-admin@example.com");
    await makeAdmin(admin.userId);
    const target = await createBusiness("Status Target Co", "status-target@example.com");
    const db = getDb();

    const toAccept = await createQuote(db, target, sampleQuoteInput());
    await updateQuoteStatus(db, target, toAccept.id, "approved");
    await updateQuoteStatus(db, target, toAccept.id, "sent");
    await updateQuoteStatus(db, target, toAccept.id, "accepted");

    const toDecline = await createQuote(db, target, sampleQuoteInput());
    await updateQuoteStatus(db, target, toDecline.id, "declined");

    const detail = await getBusinessDetailAdmin(db, admin, target.businessId);
    expect(detail?.acceptedCount).toBe(1);
    expect(detail?.declinedCount).toBe(1);
    expect(detail?.quoteCount).toBe(2);
  });

  it("returns undefined for a business that doesn't exist", async () => {
    const admin = await createBusiness("Missing Admin Co", "missing-admin@example.com");
    await makeAdmin(admin.userId);

    const detail = await getBusinessDetailAdmin(getDb(), admin, "business_does_not_exist");
    expect(detail).toBeUndefined();
  });
});

describe("listSubscriptionsAdmin", () => {
  it("includes every business's subscription with its recurring value and MRR bucket", async () => {
    const admin = await createBusiness("Sub Admin Co", "sub-admin@example.com");
    await makeAdmin(admin.userId);
    const active = await createBusiness("Active Sub Co", "active-sub@example.com");
    const trialing = await createBusiness("Trialing Sub Co", "trialing-sub@example.com");
    const db = getDb();

    await upsertSubscription(db, active.businessId, { planId: "pro", status: "active", providerStatus: "active" });
    await upsertSubscription(db, trialing.businessId, { planId: "starter", status: "trialing", providerStatus: "trialing" });

    const rows = await listSubscriptionsAdmin(db, admin);
    const activeRow = rows.find((row) => row.businessId === active.businessId);
    const trialingRow = rows.find((row) => row.businessId === trialing.businessId);

    expect(activeRow?.recurringCents).toBe(PLANS.find((p) => p.id === "pro")!.monthlyPriceCents);
    expect(activeRow?.mrrBucket).toBe("active");
    expect(activeRow?.isPastDue).toBe(false);

    expect(trialingRow?.mrrBucket).toBe("none");
  });

  it("reports a past_due subscription with its own distinguishable bucket, never silently folded into 'active'", async () => {
    const admin = await createBusiness("Sub PastDue Admin Co", "sub-pastdue-admin@example.com");
    await makeAdmin(admin.userId);
    const delinquent = await createBusiness("Sub Delinquent Co", "sub-delinquent@example.com");
    const db = getDb();

    await upsertSubscription(db, delinquent.businessId, {
      planId: "growth",
      status: "active",
      providerStatus: "past_due",
    });

    const rows = await listSubscriptionsAdmin(db, admin);
    const row = rows.find((r) => r.businessId === delinquent.businessId);

    expect(row?.status).toBe("active");
    expect(row?.providerStatus).toBe("past_due");
    expect(row?.isPastDue).toBe(true);
    expect(row?.mrrBucket).toBe("past_due");
    expect(row?.recurringCents).toBe(PLANS.find((p) => p.id === "growth")!.monthlyPriceCents);
  });
});
