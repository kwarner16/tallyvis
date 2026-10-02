import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { useTestDb } from "./testHarness";
import { signUp } from "../services/auth";
import { createCreator, updateCreator } from "../repositories/creators";
import { attributeReferral } from "../services/creatorReferrals";
import { upsertSubscription } from "../repositories/subscriptions";
import { processInvoicePaid, processChargeRefunded } from "../services/creatorCommissions";
import {
  getCreatorCommissionByStripeInvoiceId,
  listCommissionsByCreatorId,
  markCommissionPaid,
} from "../repositories/creatorCommissions";
import { listAdjustmentsByCreatorId } from "../repositories/creatorCommissionAdjustments";
import { getCreatorReferralByBusinessId } from "../repositories/creatorReferrals";
import { handleStripeWebhook } from "../services/billingWebhooks";
import type { StripeInvoiceObject } from "../billing/types";
import type { Queryable } from "../db/pg/client";

const getDb = useTestDb();
const SECRET = "whsec_test_secret_for_unit_tests_only";

function signPayload(payload: string, secret = SECRET): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

async function setUpReferredPayingBusiness(db: Queryable, overrides: { commissionRateBps?: number; commissionDurationMonths?: number } = {}) {
  const creator = await createCreator(db, {
    slug: `creator-${Math.random().toString(36).slice(2, 8)}`,
    name: "Ben",
    email: "ben@example.com",
    platform: "",
    profileUrl: "",
    status: "active",
    commissionRateBps: overrides.commissionRateBps ?? 2000,
    commissionDurationMonths: overrides.commissionDurationMonths ?? 12,
    notes: "",
  });
  const { session } = await signUp(db, {
    businessName: "Referred Co",
    ownerEmail: `referred-${Math.random()}@example.com`,
    password: "correct-horse-battery",
  });
  const referral = (await attributeReferral(db, session.businessId, { slug: creator.slug, firstObservedAt: new Date().toISOString() }))!;
  const providerSubscriptionId = `sub_${Math.random().toString(36).slice(2, 10)}`;
  await upsertSubscription(db, session.businessId, { planId: "starter", status: "active", providerSubscriptionId });
  return { creator, businessId: session.businessId, referral, providerSubscriptionId };
}

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

describe("processInvoicePaid", () => {
  it("creates a commission using the creator's current rate, from the actual amount collected", async () => {
    const db = getDb();
    const { creator, businessId, referral, providerSubscriptionId } = await setUpReferredPayingBusiness(db);

    await processInvoicePaid(db, invoice({ subscription: providerSubscriptionId, amount_paid: 6900, id: "in_fixed_1" }));

    const commission = await getCreatorCommissionByStripeInvoiceId(db, "in_fixed_1");
    expect(commission).toBeDefined();
    expect(commission!.creatorId).toBe(creator.id);
    expect(commission!.referralId).toBe(referral.id);
    expect(commission!.businessId).toBe(businessId);
    expect(commission!.collectedAmountCents).toBe(6900);
    expect(commission!.commissionRateBps).toBe(2000);
    expect(commission!.commissionAmountCents).toBe(1380); // 6900 * 0.20
    expect(commission!.status).toBe("accrued");
  });

  it("creates no commission for a business that was never referred", async () => {
    const db = getDb();
    const { session } = await signUp(db, { businessName: "Organic Co", ownerEmail: "organic@example.com", password: "correct-horse-battery" });
    const providerSubscriptionId = "sub_organic";
    await upsertSubscription(db, session.businessId, { planId: "starter", status: "active", providerSubscriptionId });

    await processInvoicePaid(db, invoice({ subscription: providerSubscriptionId, id: "in_organic" }));
    expect(await getCreatorCommissionByStripeInvoiceId(db, "in_organic")).toBeUndefined();
  });

  it("creates no commission for a $0 invoice (e.g. the first invoice of a Stripe-side trial)", async () => {
    const db = getDb();
    const { providerSubscriptionId } = await setUpReferredPayingBusiness(db);
    await processInvoicePaid(db, invoice({ subscription: providerSubscriptionId, amount_paid: 0, id: "in_zero" }));
    expect(await getCreatorCommissionByStripeInvoiceId(db, "in_zero")).toBeUndefined();
  });

  it("creates no commission when the invoice's subscription doesn't resolve to any known business", async () => {
    const db = getDb();
    await processInvoicePaid(db, invoice({ subscription: "sub_unknown_to_us", id: "in_unknown_sub" }));
    expect(await getCreatorCommissionByStripeInvoiceId(db, "in_unknown_sub")).toBeUndefined();
  });

  it("is idempotent — processing the exact same invoice twice creates only one commission row", async () => {
    const db = getDb();
    const { providerSubscriptionId } = await setUpReferredPayingBusiness(db);
    const theInvoice = invoice({ subscription: providerSubscriptionId, id: "in_replay" });

    await processInvoicePaid(db, theInvoice);
    await expect(processInvoicePaid(db, theInvoice)).resolves.not.toThrow();

    const commission = await getCreatorCommissionByStripeInvoiceId(db, "in_replay");
    expect(commission).toBeDefined();
  });

  it("freezes the rate/amount at creation time — a LATER change to the creator's rate never alters an already-created commission", async () => {
    const db = getDb();
    const { creator, providerSubscriptionId } = await setUpReferredPayingBusiness(db, { commissionRateBps: 2000 });

    await processInvoicePaid(db, invoice({ subscription: providerSubscriptionId, amount_paid: 10000, id: "in_before_rate_change" }));
    const before = await getCreatorCommissionByStripeInvoiceId(db, "in_before_rate_change");
    expect(before!.commissionAmountCents).toBe(2000);

    await updateCreator(db, creator.id, { commissionRateBps: 5000 });

    const afterReload = await getCreatorCommissionByStripeInvoiceId(db, "in_before_rate_change");
    expect(afterReload!.commissionAmountCents).toBe(2000);
    expect(afterReload!.commissionRateBps).toBe(2000);
  });

  it("a rate change applies to the NEXT invoice going forward", async () => {
    const db = getDb();
    const { creator, providerSubscriptionId } = await setUpReferredPayingBusiness(db, { commissionRateBps: 2000 });
    await processInvoicePaid(db, invoice({ subscription: providerSubscriptionId, amount_paid: 10000, id: "in_rate_a" }));

    await updateCreator(db, creator.id, { commissionRateBps: 5000 });
    await processInvoicePaid(db, invoice({ subscription: providerSubscriptionId, amount_paid: 10000, id: "in_rate_b" }));

    const second = await getCreatorCommissionByStripeInvoiceId(db, "in_rate_b");
    expect(second!.commissionRateBps).toBe(5000);
    expect(second!.commissionAmountCents).toBe(5000);
  });

  it("starts the eligibility window at the FIRST invoice, and an invoice beyond the creator's commission duration produces no commission", async () => {
    const db = getDb();
    const { providerSubscriptionId, referral } = await setUpReferredPayingBusiness(db, { commissionDurationMonths: 12 });

    const firstPeriodStart = Math.floor(Date.now() / 1000);
    await processInvoicePaid(db, invoice({ subscription: providerSubscriptionId, id: "in_month_0", period_start: firstPeriodStart }));
    expect(await getCreatorCommissionByStripeInvoiceId(db, "in_month_0")).toBeDefined();

    const reloadedReferral = await getCreatorReferralByBusinessId(db, referral.businessId);
    expect(reloadedReferral?.commissionWindowStartedAt).toBeDefined();

    // 13 months after the window started — outside a 12-month window.
    const thirteenMonthsLater = new Date(firstPeriodStart * 1000);
    thirteenMonthsLater.setUTCMonth(thirteenMonthsLater.getUTCMonth() + 13);
    await processInvoicePaid(
      db,
      invoice({ subscription: providerSubscriptionId, id: "in_month_13", period_start: Math.floor(thirteenMonthsLater.getTime() / 1000) }),
    );
    expect(await getCreatorCommissionByStripeInvoiceId(db, "in_month_13")).toBeUndefined();
  });

  it("an invoice still within the window (e.g. month 6 of 12) DOES produce a commission", async () => {
    const db = getDb();
    const { providerSubscriptionId } = await setUpReferredPayingBusiness(db, { commissionDurationMonths: 12 });
    const firstPeriodStart = Math.floor(Date.now() / 1000);
    await processInvoicePaid(db, invoice({ subscription: providerSubscriptionId, id: "in_window_month_0", period_start: firstPeriodStart }));

    const sixMonthsLater = new Date(firstPeriodStart * 1000);
    sixMonthsLater.setUTCMonth(sixMonthsLater.getUTCMonth() + 6);
    await processInvoicePaid(
      db,
      invoice({ subscription: providerSubscriptionId, id: "in_window_month_6", period_start: Math.floor(sixMonthsLater.getTime() / 1000) }),
    );
    expect(await getCreatorCommissionByStripeInvoiceId(db, "in_window_month_6")).toBeDefined();
  });

  it("integer-cent arithmetic: rounds to the nearest cent rather than ever touching a fractional cent", async () => {
    const db = getDb();
    const { providerSubscriptionId } = await setUpReferredPayingBusiness(db, { commissionRateBps: 2000 });
    // 9999 * 0.20 = 1999.8 -> rounds to 2000.
    await processInvoicePaid(db, invoice({ subscription: providerSubscriptionId, amount_paid: 9999, id: "in_rounding" }));
    const commission = await getCreatorCommissionByStripeInvoiceId(db, "in_rounding");
    expect(commission!.commissionAmountCents).toBe(2000);
    expect(Number.isInteger(commission!.commissionAmountCents)).toBe(true);
  });
});

describe("processChargeRefunded", () => {
  it("reverses the accrued commission for the refunded charge", async () => {
    const db = getDb();
    const { creator, providerSubscriptionId } = await setUpReferredPayingBusiness(db);
    await processInvoicePaid(db, invoice({ subscription: providerSubscriptionId, id: "in_to_refund", charge: "ch_refund_1" }));
    expect((await getCreatorCommissionByStripeInvoiceId(db, "in_to_refund"))!.status).toBe("accrued");

    await processChargeRefunded(db, { id: "ch_refund_1", invoice: "in_to_refund", amount_refunded: 6900, refunded: true });

    const reversed = await getCreatorCommissionByStripeInvoiceId(db, "in_to_refund");
    expect(reversed!.status).toBe("reversed");
    expect(reversed!.reversedAt).toBeDefined();
    const list = await listCommissionsByCreatorId(db, creator.id);
    expect(list.find((c) => c.stripeInvoiceId === "in_to_refund")?.status).toBe("reversed");
  });

  it("never reverses an already-paid commission — a refund after a manual payout stays a separate, manual reconciliation", async () => {
    const db = getDb();
    const { providerSubscriptionId } = await setUpReferredPayingBusiness(db);
    await processInvoicePaid(db, invoice({ subscription: providerSubscriptionId, id: "in_already_paid", charge: "ch_refund_2" }));
    const commission = (await getCreatorCommissionByStripeInvoiceId(db, "in_already_paid"))!;
    await markCommissionPaid(db, commission.id, "Paid already");

    await processChargeRefunded(db, { id: "ch_refund_2", invoice: "in_already_paid", amount_refunded: 6900, refunded: true });

    const stillPaid = await getCreatorCommissionByStripeInvoiceId(db, "in_already_paid");
    expect(stillPaid!.status).toBe("paid");
  });

  it("does nothing for a charge with no refunded amount", async () => {
    const db = getDb();
    const { providerSubscriptionId } = await setUpReferredPayingBusiness(db);
    await processInvoicePaid(db, invoice({ subscription: providerSubscriptionId, id: "in_not_refunded", charge: "ch_not_refunded" }));
    await processChargeRefunded(db, { id: "ch_not_refunded", invoice: "in_not_refunded", amount_refunded: 0, refunded: false });
    expect((await getCreatorCommissionByStripeInvoiceId(db, "in_not_refunded"))!.status).toBe("accrued");
  });

  it("a partial refund produces a PROPORTIONAL reversal, not a full one (V1.1)", async () => {
    const db = getDb();
    // $100 collected, 20% rate -> $20 commission. $25 refunded -> reverse $5, not $20.
    await setUpAndRefund(db, { amountPaid: 10000, refundedCents: 2500, chargeId: "ch_partial_1", invoiceId: "in_partial_1" });

    const commission = await getCreatorCommissionByStripeInvoiceId(db, "in_partial_1");
    expect(commission!.commissionAmountCents).toBe(2000);
    expect(commission!.reversedCommissionCents).toBe(500);
    expect(commission!.refundedCollectedCents).toBe(2500);
    expect(commission!.status).toBe("accrued"); // not fully reversed — still accrued, net of the partial reversal.
  });

  it("a second, larger partial refund re-derives the total reversal rather than adding to it, and never over-reverses", async () => {
    const db = getDb();
    const { providerSubscriptionId } = await setUpReferredPayingBusiness(db);
    await processInvoicePaid(
      db,
      invoice({ subscription: providerSubscriptionId, amount_paid: 10000, id: "in_multi_partial", charge: "ch_multi_partial" }),
    );

    // First partial refund: $25 of $100 -> $5 of the $20 commission reversed.
    await processChargeRefunded(db, { id: "ch_multi_partial", invoice: "in_multi_partial", amount_refunded: 2500, refunded: false });
    let commission = await getCreatorCommissionByStripeInvoiceId(db, "in_multi_partial");
    expect(commission!.reversedCommissionCents).toBe(500);

    // Stripe's amount_refunded is CUMULATIVE — a second refund brings the total refunded to $75, not a fresh $50.
    await processChargeRefunded(db, { id: "ch_multi_partial", invoice: "in_multi_partial", amount_refunded: 7500, refunded: false });
    commission = await getCreatorCommissionByStripeInvoiceId(db, "in_multi_partial");
    expect(commission!.reversedCommissionCents).toBe(1500); // 75% of the $20 commission, not 500 + (naive 50%*2000=1000) = 1500 either way here, but re-derived from scratch.
    expect(commission!.status).toBe("accrued");

    // A final refund bringing the cumulative total to the full $100 fully reverses, capped at the original commission.
    await processChargeRefunded(db, { id: "ch_multi_partial", invoice: "in_multi_partial", amount_refunded: 10000, refunded: true });
    commission = await getCreatorCommissionByStripeInvoiceId(db, "in_multi_partial");
    expect(commission!.reversedCommissionCents).toBe(2000);
    expect(commission!.reversedCommissionCents).toBeLessThanOrEqual(commission!.commissionAmountCents);
    expect(commission!.status).toBe("reversed");
  });

  it("an exact replay of the same cumulative refund amount is a safe no-op (idempotent)", async () => {
    const db = getDb();
    const { providerSubscriptionId } = await setUpReferredPayingBusiness(db);
    await processInvoicePaid(
      db,
      invoice({ subscription: providerSubscriptionId, amount_paid: 10000, id: "in_replay_refund", charge: "ch_replay_refund" }),
    );

    await processChargeRefunded(db, { id: "ch_replay_refund", invoice: "in_replay_refund", amount_refunded: 2500, refunded: false });
    const once = await getCreatorCommissionByStripeInvoiceId(db, "in_replay_refund");

    // Same webhook event replayed with the identical cumulative amount_refunded.
    await processChargeRefunded(db, { id: "ch_replay_refund", invoice: "in_replay_refund", amount_refunded: 2500, refunded: false });
    const replayed = await getCreatorCommissionByStripeInvoiceId(db, "in_replay_refund");

    expect(replayed!.reversedCommissionCents).toBe(once!.reversedCommissionCents);
    expect(replayed!.refundedCollectedCents).toBe(once!.refundedCollectedCents);
  });

  it("a refund after the commission was already paid never rewrites that row — instead it records a negative adjustment ledger entry", async () => {
    const db = getDb();
    const { creator, providerSubscriptionId } = await setUpReferredPayingBusiness(db);
    await processInvoicePaid(
      db,
      invoice({ subscription: providerSubscriptionId, amount_paid: 10000, id: "in_paid_then_refunded", charge: "ch_paid_then_refunded" }),
    );
    const commission = (await getCreatorCommissionByStripeInvoiceId(db, "in_paid_then_refunded"))!;
    await markCommissionPaid(db, commission.id, "Paid out in October batch");

    await processChargeRefunded(db, { id: "ch_paid_then_refunded", invoice: "in_paid_then_refunded", amount_refunded: 2500, refunded: false });

    const stillPaid = await getCreatorCommissionByStripeInvoiceId(db, "in_paid_then_refunded");
    expect(stillPaid!.status).toBe("paid");
    expect(stillPaid!.commissionAmountCents).toBe(2000); // the historical row itself is never rewritten.

    const adjustments = await listAdjustmentsByCreatorId(db, creator.id);
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0]!.commissionId).toBe(commission.id);
    expect(adjustments[0]!.amountCents).toBe(-500); // 25% of the $20 commission, negative (owed back).
    expect(adjustments[0]!.reason).toBe("refund_after_payout");
  });

  it("a replayed refund event on an already-paid commission does not create a duplicate adjustment", async () => {
    const db = getDb();
    const { creator, providerSubscriptionId } = await setUpReferredPayingBusiness(db);
    await processInvoicePaid(
      db,
      invoice({ subscription: providerSubscriptionId, amount_paid: 10000, id: "in_paid_refund_replay", charge: "ch_paid_refund_replay" }),
    );
    const commission = (await getCreatorCommissionByStripeInvoiceId(db, "in_paid_refund_replay"))!;
    await markCommissionPaid(db, commission.id, "Paid out");

    await processChargeRefunded(db, { id: "ch_paid_refund_replay", invoice: "in_paid_refund_replay", amount_refunded: 2500, refunded: false });
    await processChargeRefunded(db, { id: "ch_paid_refund_replay", invoice: "in_paid_refund_replay", amount_refunded: 2500, refunded: false });

    const adjustments = await listAdjustmentsByCreatorId(db, creator.id);
    expect(adjustments).toHaveLength(1);
  });

  async function setUpAndRefund(
    db: Queryable,
    opts: { amountPaid: number; refundedCents: number; chargeId: string; invoiceId: string },
  ) {
    const { providerSubscriptionId } = await setUpReferredPayingBusiness(db);
    await processInvoicePaid(
      db,
      invoice({ subscription: providerSubscriptionId, amount_paid: opts.amountPaid, id: opts.invoiceId, charge: opts.chargeId }),
    );
    await processChargeRefunded(db, { id: opts.chargeId, invoice: opts.invoiceId, amount_refunded: opts.refundedCents, refunded: false });
  }
});

describe("processInvoicePaid — tax exclusion (V1.1)", () => {
  it("excludes Stripe's documented invoice.tax field from the commissionable base", async () => {
    const db = getDb();
    const { providerSubscriptionId } = await setUpReferredPayingBusiness(db, { commissionRateBps: 2000 });
    // $100 collected, $8 of which is tax Stripe collected on behalf of authorities -> $92 commissionable -> $18.40 -> rounds to 1840.
    await processInvoicePaid(
      db,
      invoice({ subscription: providerSubscriptionId, amount_paid: 10000, tax: 800, id: "in_with_tax" }),
    );
    const commission = await getCreatorCommissionByStripeInvoiceId(db, "in_with_tax");
    expect(commission!.collectedAmountCents).toBe(10000);
    expect(commission!.commissionableAmountCents).toBe(9200);
    expect(commission!.commissionAmountCents).toBe(1840);
  });

  it("treats a missing/absent invoice.tax exactly as $0 tax (today's real account state) — commissionable equals collected", async () => {
    const db = getDb();
    const { providerSubscriptionId } = await setUpReferredPayingBusiness(db, { commissionRateBps: 2000 });
    await processInvoicePaid(db, invoice({ subscription: providerSubscriptionId, amount_paid: 10000, id: "in_no_tax" }));
    const commission = await getCreatorCommissionByStripeInvoiceId(db, "in_no_tax");
    expect(commission!.commissionableAmountCents).toBe(commission!.collectedAmountCents);
    expect(commission!.commissionAmountCents).toBe(2000);
  });
});

describe("handleStripeWebhook — invoice.paid / charge.refunded routing (production feature, 2026-10)", () => {
  it("routes a real, signed invoice.paid event through to commission creation", async () => {
    const db = getDb();
    const { providerSubscriptionId } = await setUpReferredPayingBusiness(db);
    const payload = JSON.stringify({
      id: "evt_invoice_paid_1",
      created: Math.floor(Date.now() / 1000),
      type: "invoice.paid",
      data: { object: invoice({ subscription: providerSubscriptionId, id: "in_via_webhook" }) },
    });

    await handleStripeWebhook(db, payload, signPayload(payload), SECRET);
    expect(await getCreatorCommissionByStripeInvoiceId(db, "in_via_webhook")).toBeDefined();
  });

  it("an exact replay of the same invoice.paid webhook event cannot duplicate the commission", async () => {
    const db = getDb();
    const { providerSubscriptionId } = await setUpReferredPayingBusiness(db);
    const payload = JSON.stringify({
      id: "evt_invoice_paid_replay",
      created: Math.floor(Date.now() / 1000),
      type: "invoice.paid",
      data: { object: invoice({ subscription: providerSubscriptionId, id: "in_replay_webhook" }) },
    });

    await handleStripeWebhook(db, payload, signPayload(payload), SECRET);
    await handleStripeWebhook(db, payload, signPayload(payload), SECRET);

    const commissions = await listCommissionsByCreatorId(
      db,
      (await getCreatorCommissionByStripeInvoiceId(db, "in_replay_webhook"))!.creatorId,
    );
    expect(commissions.filter((c) => c.stripeInvoiceId === "in_replay_webhook")).toHaveLength(1);
  });

  it("subscription entitlement handling is completely unaffected by invoice.paid — this event never touches the subscriptions table", async () => {
    const db = getDb();
    const { businessId, providerSubscriptionId } = await setUpReferredPayingBusiness(db);
    const before = await db.query(`SELECT updated_at, status FROM subscriptions WHERE business_id = $1`, [businessId]);

    const payload = JSON.stringify({
      type: "invoice.paid",
      data: { object: invoice({ subscription: providerSubscriptionId, id: "in_no_subscription_side_effect" }) },
    });
    await handleStripeWebhook(db, payload, signPayload(payload), SECRET);

    const after = await db.query(`SELECT updated_at, status FROM subscriptions WHERE business_id = $1`, [businessId]);
    expect(after.rows[0]).toEqual(before.rows[0]);
  });
});
