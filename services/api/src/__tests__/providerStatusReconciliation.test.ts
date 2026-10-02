import { afterEach, describe, expect, it, vi } from "vitest";
import { PLANS } from "@tallyvis/config";
import { useTestDb } from "./testHarness";
import { signUp } from "../services/auth";
import { hasProductAccess } from "../services/subscriptions";
import { getAdminOverview } from "../services/admin";
import { setUserIsAdmin } from "../repositories/users";
import { upsertSubscription, getSubscriptionByBusinessId } from "../repositories/subscriptions";
import { reconcileProviderStatuses } from "../services/providerStatusReconciliation";

const getDb = useTestDb();

/**
 * Coverage for the founder-run `reconcile-provider-status` CLI's actual
 * logic (see docs/decisions/0037-provider-status-reconciliation.md). Real
 * database, mocked Stripe — the same pattern
 * `subscriptions.test.ts`'s `reconcileSubscriptionFromStripe` tests
 * already use.
 */

const growthPriceCents = PLANS.find((p) => p.id === "growth")!.monthlyPriceCents;

async function createBusiness(name: string, email: string) {
  const db = getDb();
  const { session } = await signUp(db, { businessName: name, ownerEmail: email, password: "correct-horse-battery" });
  return session;
}

async function makeAdmin(userId: string) {
  await setUserIsAdmin(getDb(), userId, true);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reconcileProviderStatuses", () => {
  it("skips a subscription with no Stripe subscription id on file, without contacting Stripe", async () => {
    const db = getDb();
    const session = await createBusiness("No Stripe Id Co", "no-stripe-id@example.com");
    await upsertSubscription(db, session.businessId, { planId: "starter", status: "trialing" });

    const billing = await import("../billing");
    const retrieveSpy = vi.spyOn(billing, "retrieveSubscription");

    const result = await reconcileProviderStatuses(db, { apply: true });

    expect(result.skippedNoProviderSubscriptionId).toBe(1);
    expect(result.changes).toHaveLength(0);
    expect(retrieveSpy).not.toHaveBeenCalled();
  });

  it("dry run reports the change but writes nothing to the database", async () => {
    const db = getDb();
    const session = await createBusiness("Dry Run Co", "dry-run@example.com");
    await upsertSubscription(db, session.businessId, {
      planId: "growth",
      status: "active",
      providerSubscriptionId: "sub_dry_run",
    });

    const billing = await import("../billing");
    vi.spyOn(billing, "retrieveSubscription").mockResolvedValue({ id: "sub_dry_run", status: "active" } as never);

    const result = await reconcileProviderStatuses(db, { apply: false });

    expect(result.changes).toEqual([
      {
        businessId: session.businessId,
        businessName: "Dry Run Co",
        providerSubscriptionId: "sub_dry_run",
        previousProviderStatus: undefined,
        newProviderStatus: "active",
      },
    ]);

    const stored = await getSubscriptionByBusinessId(db, session.businessId);
    expect(stored?.providerStatus).toBeUndefined();
  });

  it("apply mode writes exactly the reported change", async () => {
    const db = getDb();
    const session = await createBusiness("Apply Co", "apply@example.com");
    await upsertSubscription(db, session.businessId, {
      planId: "growth",
      status: "active",
      providerSubscriptionId: "sub_apply",
    });

    const billing = await import("../billing");
    vi.spyOn(billing, "retrieveSubscription").mockResolvedValue({ id: "sub_apply", status: "past_due" } as never);

    await reconcileProviderStatuses(db, { apply: true });

    const stored = await getSubscriptionByBusinessId(db, session.businessId);
    expect(stored?.providerStatus).toBe("past_due");
  });

  it("never alters status, plan_id, or entitlement, regardless of what Stripe reports", async () => {
    const db = getDb();
    const session = await createBusiness("Entitlement Co", "entitlement@example.com");
    await upsertSubscription(db, session.businessId, {
      planId: "growth",
      status: "active",
      providerSubscriptionId: "sub_entitlement",
    });

    const billing = await import("../billing");
    // Stripe already reports "canceled" — simulating a real webhook that
    // hasn't landed yet. This script must still leave local `status`
    // (the entitlement signal) completely untouched.
    vi.spyOn(billing, "retrieveSubscription").mockResolvedValue({ id: "sub_entitlement", status: "canceled" } as never);

    await reconcileProviderStatuses(db, { apply: true });

    const stored = await getSubscriptionByBusinessId(db, session.businessId);
    expect(stored?.status).toBe("active");
    expect(stored?.planId).toBe("growth");
    expect(stored?.providerStatus).toBe("canceled");
    expect(hasProductAccess(stored)).toBe(true);
  });

  it("is idempotent — a second run against an unchanged Stripe status reports no further changes", async () => {
    const db = getDb();
    const session = await createBusiness("Idempotent Co", "idempotent@example.com");
    await upsertSubscription(db, session.businessId, {
      planId: "starter",
      status: "active",
      providerSubscriptionId: "sub_idempotent",
    });

    const billing = await import("../billing");
    vi.spyOn(billing, "retrieveSubscription").mockResolvedValue({ id: "sub_idempotent", status: "active" } as never);

    const first = await reconcileProviderStatuses(db, { apply: true });
    expect(first.changes).toHaveLength(1);

    const second = await reconcileProviderStatuses(db, { apply: true });
    expect(second.changes).toHaveLength(0);
    expect(second.unchangedCount).toBe(1);
  });

  it("a Stripe failure for one subscription does not abort or corrupt processing of the others", async () => {
    const db = getDb();
    const failing = await createBusiness("Failing Co", "failing@example.com");
    await upsertSubscription(db, failing.businessId, {
      planId: "starter",
      status: "active",
      providerSubscriptionId: "sub_failing",
    });
    const healthy = await createBusiness("Healthy Co", "healthy@example.com");
    await upsertSubscription(db, healthy.businessId, {
      planId: "growth",
      status: "active",
      providerSubscriptionId: "sub_healthy",
    });

    const billing = await import("../billing");
    vi.spyOn(billing, "retrieveSubscription").mockImplementation(async (id: string) => {
      if (id === "sub_failing") throw new Error("Stripe is unreachable (simulated)");
      return { id, status: "past_due" } as never;
    });

    const result = await reconcileProviderStatuses(db, { apply: true });

    expect(result.failures).toEqual([
      {
        businessId: failing.businessId,
        businessName: "Failing Co",
        providerSubscriptionId: "sub_failing",
        error: "Stripe is unreachable (simulated)",
      },
    ]);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]?.businessId).toBe(healthy.businessId);

    const healthyStored = await getSubscriptionByBusinessId(db, healthy.businessId);
    expect(healthyStored?.providerStatus).toBe("past_due");
    const failingStored = await getSubscriptionByBusinessId(db, failing.businessId);
    expect(failingStored?.providerStatus).toBeUndefined(); // untouched — never partially written
  });
});

describe("admin metrics after reconciliation", () => {
  it("a legacy (provider_status NULL) active subscription moves from Active MRR into Past-Due MRR exposure once reconciled to past_due", async () => {
    const db = getDb();
    const admin = await createBusiness("Metrics Admin Co", "metrics-admin@example.com");
    await makeAdmin(admin.userId);
    const target = await createBusiness("Legacy Target Co", "legacy-target@example.com");
    await upsertSubscription(db, target.businessId, {
      planId: "growth",
      status: "active",
      providerSubscriptionId: "sub_legacy",
    });

    const before = await getAdminOverview(db, admin);
    expect(before.mrr.activeMrrCents).toBe(growthPriceCents);
    expect(before.mrr.pastDueMrrCents).toBe(0);
    expect(before.subscriptions.active).toBe(1);
    expect(before.subscriptions.pastDue).toBe(0);

    const billing = await import("../billing");
    vi.spyOn(billing, "retrieveSubscription").mockResolvedValue({ id: "sub_legacy", status: "past_due" } as never);
    await reconcileProviderStatuses(db, { apply: true });

    const after = await getAdminOverview(db, admin);
    expect(after.mrr.activeMrrCents).toBe(0);
    expect(after.mrr.pastDueMrrCents).toBe(growthPriceCents);
    expect(after.subscriptions.active).toBe(0);
    expect(after.subscriptions.pastDue).toBe(1);
  });

  it("reconciling a confirmed-active subscription keeps it in Active MRR, not Past-Due", async () => {
    const db = getDb();
    const admin = await createBusiness("Metrics Admin Active Co", "metrics-admin-active@example.com");
    await makeAdmin(admin.userId);
    const target = await createBusiness("Confirmed Active Co", "confirmed-active@example.com");
    await upsertSubscription(db, target.businessId, {
      planId: "pro",
      status: "active",
      providerSubscriptionId: "sub_confirmed_active",
    });

    const billing = await import("../billing");
    vi.spyOn(billing, "retrieveSubscription").mockResolvedValue({ id: "sub_confirmed_active", status: "active" } as never);
    await reconcileProviderStatuses(db, { apply: true });

    const overview = await getAdminOverview(db, admin);
    expect(overview.mrr.activeMrrCents).toBe(PLANS.find((p) => p.id === "pro")!.monthlyPriceCents);
    expect(overview.mrr.pastDueMrrCents).toBe(0);
  });

  it("canceled, trialing, and incomplete subscriptions never contribute to either MRR bucket after reconciliation", async () => {
    const db = getDb();
    const admin = await createBusiness("Metrics Admin Mixed Co", "metrics-admin-mixed@example.com");
    await makeAdmin(admin.userId);

    const canceledBiz = await createBusiness("Mixed Canceled Co", "mixed-canceled@example.com");
    await upsertSubscription(db, canceledBiz.businessId, {
      planId: "growth",
      status: "canceled",
      providerSubscriptionId: "sub_mixed_canceled",
      canceledAt: new Date().toISOString(),
    });
    const trialingBiz = await createBusiness("Mixed Trialing Co", "mixed-trialing@example.com");
    await upsertSubscription(db, trialingBiz.businessId, {
      planId: "starter",
      status: "trialing",
      providerSubscriptionId: "sub_mixed_trialing",
    });
    const incompleteBiz = await createBusiness("Mixed Incomplete Co", "mixed-incomplete@example.com");
    await upsertSubscription(db, incompleteBiz.businessId, {
      planId: "pro",
      status: "incomplete",
      providerSubscriptionId: "sub_mixed_incomplete",
    });

    const billing = await import("../billing");
    vi.spyOn(billing, "retrieveSubscription").mockImplementation(async (id: string) => {
      const statusById: Record<string, string> = {
        sub_mixed_canceled: "canceled",
        sub_mixed_trialing: "trialing",
        sub_mixed_incomplete: "incomplete",
      };
      return { id, status: statusById[id] } as never;
    });
    await reconcileProviderStatuses(db, { apply: true });

    const overview = await getAdminOverview(db, admin);
    expect(overview.mrr.activeMrrCents).toBe(0);
    expect(overview.mrr.pastDueMrrCents).toBe(0);
    expect(overview.subscriptions.canceled).toBe(1);
    expect(overview.subscriptions.trialing).toBe(1);
    expect(overview.subscriptions.incomplete).toBe(1);
  });
});
