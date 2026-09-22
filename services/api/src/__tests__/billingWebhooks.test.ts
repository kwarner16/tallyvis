import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "../db/client";
import { signUp } from "../services/auth";
import { verifyStripeWebhookSignature } from "../billing/verifyWebhookSignature";
import { handleStripeWebhook, WebhookVerificationError } from "../services/billingWebhooks";
import { getSubscription, chooseSelfInstall, createInstallationCheckoutSession, listBillingCharges } from "../services/subscriptions";
import { startTrial } from "../services/subscriptions";
import { upsertSubscription } from "../repositories/subscriptions";

/**
 * Phase 14 — reconciling internal subscription state against Stripe (see
 * docs/decisions/0016-onboarding-billing-embed.md), hardened for V1 in
 * docs/decisions/0018-stripe-v1-hardening.md. No real Stripe webhook has
 * been received in this environment; these tests verify the signature
 * algorithm against Stripe's own documented construction and the event
 * handling against Stripe's documented payload shape — not a live
 * integration. See the file's own header comment for the same caveat.
 */

const SECRET = "whsec_test_secret_for_unit_tests_only";
const NOW_SECONDS = Math.floor(Date.now() / 1000);

function signPayload(payload: string, secret = SECRET, timestamp = Math.floor(Date.now() / 1000)): string {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

async function newBusiness(db: ReturnType<typeof createTestDb>, email = "owner@sparkle.example") {
  const { session } = await signUp(db, {
    businessName: "Sparkle Windows",
    ownerEmail: email,
    password: "correct-horse-battery",
  });
  return session;
}

describe("verifyStripeWebhookSignature", () => {
  it("accepts a correctly signed payload", () => {
    const payload = JSON.stringify({ type: "test.event" });
    expect(verifyStripeWebhookSignature(payload, signPayload(payload), SECRET)).toBe(true);
  });

  it("rejects a payload signed with the wrong secret", () => {
    const payload = JSON.stringify({ type: "test.event" });
    expect(verifyStripeWebhookSignature(payload, signPayload(payload, "whsec_wrong_secret"), SECRET)).toBe(false);
  });

  it("rejects a tampered payload (signature no longer matches the body)", () => {
    const payload = JSON.stringify({ type: "test.event", amount: 100 });
    const header = signPayload(payload);
    const tampered = JSON.stringify({ type: "test.event", amount: 999999 });
    expect(verifyStripeWebhookSignature(tampered, header, SECRET)).toBe(false);
  });

  it("rejects a header missing the v1 signature or timestamp", () => {
    const payload = JSON.stringify({ type: "test.event" });
    expect(verifyStripeWebhookSignature(payload, "t=12345", SECRET)).toBe(false);
    expect(verifyStripeWebhookSignature(payload, "v1=deadbeef", SECRET)).toBe(false);
  });

  it("rejects a payload signed far outside the tolerance window (replay protection)", () => {
    const payload = JSON.stringify({ type: "test.event" });
    const oldTimestamp = Math.floor(Date.now() / 1000) - 10_000;
    expect(verifyStripeWebhookSignature(payload, signPayload(payload, SECRET, oldTimestamp), SECRET)).toBe(false);
  });
});

describe("handleStripeWebhook — checkout.session.completed (subscription mode)", () => {
  it("throws WebhookVerificationError and applies nothing for an invalid signature", async () => {
    const db = createTestDb();
    const session = await newBusiness(db);
    startTrial(db, session, "starter");
    const before = getSubscription(db, session);

    const payload = JSON.stringify({
      type: "checkout.session.completed",
      data: { object: { customer: "cus_x", subscription: "sub_x", metadata: { businessId: session.businessId } } },
    });

    expect(() => handleStripeWebhook(db, payload, "t=1,v1=not-a-real-signature", SECRET)).toThrow(
      WebhookVerificationError,
    );
    expect(getSubscription(db, session)).toEqual(before);
  });

  it("links the Stripe customer/subscription ids WITHOUT forcing status to active (regression: this used to hardcode active even for a trialing subscription)", async () => {
    const db = createTestDb();
    const session = await newBusiness(db);
    // Simulate the real production path: createCheckoutSessionForPlan leaves status "incomplete" pending a webhook.
    upsertSubscription(db, session.businessId, { planId: "growth", status: "incomplete" });

    const payload = JSON.stringify({
      id: "evt_checkout_1",
      created: NOW_SECONDS,
      type: "checkout.session.completed",
      data: {
        object: {
          customer: "cus_abc123",
          subscription: "sub_abc123",
          metadata: { businessId: session.businessId, planId: "growth" },
        },
      },
    });

    handleStripeWebhook(db, payload, signPayload(payload), SECRET);

    const subscription = getSubscription(db, session)!;
    // Status is untouched by this event — still "incomplete" until
    // customer.subscription.created (below) supplies the real status.
    expect(subscription.status).toBe("incomplete");
    expect(subscription.billingCustomerId).toBe("cus_abc123");
    expect(subscription.providerSubscriptionId).toBe("sub_abc123");
  });

  it("ignores a checkout.session.completed event with no businessId in metadata (not one of ours)", async () => {
    const db = createTestDb();
    const payload = JSON.stringify({
      type: "checkout.session.completed",
      data: { object: { customer: "cus_x", subscription: "sub_x", metadata: {} } },
    });
    expect(() => handleStripeWebhook(db, payload, signPayload(payload), SECRET)).not.toThrow();
  });
});

describe("handleStripeWebhook — customer.subscription.created (fixes the status-mapping bug)", () => {
  it("sets status to trialing when Stripe reports the new subscription as trialing", async () => {
    const db = createTestDb();
    const session = await newBusiness(db);
    upsertSubscription(db, session.businessId, {
      planId: "growth",
      status: "incomplete",
      providerSubscriptionId: "sub_new_trial",
    });

    const payload = JSON.stringify({
      id: "evt_sub_created_1",
      created: NOW_SECONDS,
      type: "customer.subscription.created",
      data: { object: { id: "sub_new_trial", status: "trialing" } },
    });
    handleStripeWebhook(db, payload, signPayload(payload), SECRET);

    expect(getSubscription(db, session)?.status).toBe("trialing");
  });

  it("the full realistic sequence — checkout.session.completed then customer.subscription.created — ends up trialing, never incorrectly active", async () => {
    const db = createTestDb();
    const session = await newBusiness(db);
    upsertSubscription(db, session.businessId, { planId: "pro", status: "incomplete" });

    const checkoutPayload = JSON.stringify({
      id: "evt_seq_checkout",
      created: NOW_SECONDS,
      type: "checkout.session.completed",
      data: {
        object: { customer: "cus_seq", subscription: "sub_seq", metadata: { businessId: session.businessId, planId: "pro" } },
      },
    });
    handleStripeWebhook(db, checkoutPayload, signPayload(checkoutPayload), SECRET);
    expect(getSubscription(db, session)?.status).toBe("incomplete");

    const subCreatedPayload = JSON.stringify({
      id: "evt_seq_sub_created",
      created: NOW_SECONDS + 1,
      type: "customer.subscription.created",
      data: { object: { id: "sub_seq", status: "trialing" } },
    });
    handleStripeWebhook(db, subCreatedPayload, signPayload(subCreatedPayload), SECRET);

    const final = getSubscription(db, session)!;
    expect(final.status).toBe("trialing");
    expect(final.billingCustomerId).toBe("cus_seq");
    expect(final.providerSubscriptionId).toBe("sub_seq");
  });

  it("persists Stripe's own trial_start/trial_end onto our row (regression: these were never written for a real webhook-driven subscription, so the dashboard's 'X of 7 days remaining' UI silently showed nothing for every real customer)", async () => {
    const db = createTestDb();
    const session = await newBusiness(db);
    upsertSubscription(db, session.businessId, {
      planId: "growth",
      status: "incomplete",
      providerSubscriptionId: "sub_with_trial_dates",
    });

    const trialStartSeconds = NOW_SECONDS;
    const trialEndSeconds = NOW_SECONDS + 7 * 24 * 60 * 60;
    const payload = JSON.stringify({
      id: "evt_trial_dates",
      created: NOW_SECONDS,
      type: "customer.subscription.created",
      data: { object: { id: "sub_with_trial_dates", status: "trialing", trial_start: trialStartSeconds, trial_end: trialEndSeconds } },
    });
    handleStripeWebhook(db, payload, signPayload(payload), SECRET);

    const updated = getSubscription(db, session)!;
    expect(updated.trialStartedAt).toBe(new Date(trialStartSeconds * 1000).toISOString());
    expect(updated.trialEndsAt).toBe(new Date(trialEndSeconds * 1000).toISOString());
  });
});

describe("handleStripeWebhook — customer.subscription.updated / .deleted", () => {
  it("syncs status to canceled on customer.subscription.deleted", async () => {
    const db = createTestDb();
    const session = await newBusiness(db);
    startTrial(db, session, "starter");
    upsertSubscription(db, session.businessId, {
      planId: "starter",
      status: "active",
      providerSubscriptionId: "sub_to_cancel",
    });

    const payload = JSON.stringify({
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_to_cancel", status: "canceled" } },
    });
    handleStripeWebhook(db, payload, signPayload(payload), SECRET);

    expect(getSubscription(db, session)?.status).toBe("canceled");
  });

  it("maps Stripe's past_due status to still-active internal access", async () => {
    const db = createTestDb();
    const session = await newBusiness(db);
    upsertSubscription(db, session.businessId, {
      planId: "starter",
      status: "active",
      providerSubscriptionId: "sub_past_due",
    });

    const payload = JSON.stringify({
      type: "customer.subscription.updated",
      data: { object: { id: "sub_past_due", status: "past_due" } },
    });
    handleStripeWebhook(db, payload, signPayload(payload), SECRET);

    expect(getSubscription(db, session)?.status).toBe("active");
  });

  it("maps unpaid/incomplete_expired/paused to expired (denies access)", async () => {
    const db = createTestDb();
    for (const [stripeStatus, subId] of [
      ["unpaid", "sub_unpaid"],
      ["incomplete_expired", "sub_incomplete_expired"],
      ["paused", "sub_paused"],
    ] as const) {
      const session = await newBusiness(db, `owner-${stripeStatus}@sparkle.example`);
      upsertSubscription(db, session.businessId, { planId: "starter", status: "active", providerSubscriptionId: subId });

      const payload = JSON.stringify({ type: "customer.subscription.updated", data: { object: { id: subId, status: stripeStatus } } });
      handleStripeWebhook(db, payload, signPayload(payload), SECRET);

      expect(getSubscription(db, session)?.status).toBe("expired");
    }
  });

  it("does nothing for a subscription-updated event referencing an id we don't have on file", async () => {
    const db = createTestDb();
    const payload = JSON.stringify({
      type: "customer.subscription.updated",
      data: { object: { id: "sub_unknown_to_us", status: "active" } },
    });
    expect(() => handleStripeWebhook(db, payload, signPayload(payload), SECRET)).not.toThrow();
  });

  it("ignores an event type this app doesn't handle, without throwing (e.g. invoice.paid, invoice.payment_failed)", async () => {
    const db = createTestDb();
    for (const type of ["invoice.paid", "invoice.payment_failed", "checkout.session.expired"]) {
      const payload = JSON.stringify({ type, data: { object: { id: "in_123" } } });
      expect(() => handleStripeWebhook(db, payload, signPayload(payload), SECRET)).not.toThrow();
    }
  });

  it("rejects a malformed (non-JSON) payload with a clean error, never a crash — signature is checked first, so a validly-signed non-JSON body still fails safely", async () => {
    const db = createTestDb();
    const malformed = "{not valid json";
    expect(() => handleStripeWebhook(db, malformed, signPayload(malformed), SECRET)).toThrow();
  });
});

describe("handleStripeWebhook — plan switching (Customer Portal-driven price change)", () => {
  beforeEach(() => {
    process.env.STRIPE_PRICE_STARTER = "price_test_starter";
    process.env.STRIPE_PRICE_GROWTH = "price_test_growth";
    process.env.STRIPE_PRICE_PRO = "price_test_pro";
  });
  afterEach(() => {
    delete process.env.STRIPE_PRICE_STARTER;
    delete process.env.STRIPE_PRICE_GROWTH;
    delete process.env.STRIPE_PRICE_PRO;
  });

  it("Growth -> Pro: a subscription.updated event with the new Price id resolves and updates planId", async () => {
    const db = createTestDb();
    const session = await newBusiness(db);
    const original = startTrial(db, session, "growth");
    upsertSubscription(db, session.businessId, { planId: "growth", status: "trialing", providerSubscriptionId: "sub_switch" });

    const payload = JSON.stringify({
      id: "evt_switch_1",
      created: NOW_SECONDS,
      type: "customer.subscription.updated",
      data: { object: { id: "sub_switch", status: "trialing", items: { data: [{ price: { id: "price_test_pro" } }] } } },
    });
    handleStripeWebhook(db, payload, signPayload(payload), SECRET);

    const after = getSubscription(db, session)!;
    expect(after.planId).toBe("pro");
    // Switching plans must never reset the trial clock.
    expect(after.trialStartedAt).toBe(original.trialStartedAt);
    expect(after.trialEndsAt).toBe(original.trialEndsAt);
  });

  it("Pro -> Starter -> Growth: each switch updates planId without creating a second subscription row", async () => {
    const db = createTestDb();
    const session = await newBusiness(db);
    startTrial(db, session, "pro");
    upsertSubscription(db, session.businessId, { planId: "pro", status: "active", providerSubscriptionId: "sub_multi_switch" });
    const originalId = getSubscription(db, session)!.id;

    for (const [priceId, expectedPlan] of [
      ["price_test_starter", "starter"],
      ["price_test_growth", "growth"],
    ] as const) {
      const payload = JSON.stringify({
        id: `evt_multi_${priceId}`,
        created: NOW_SECONDS + 1,
        type: "customer.subscription.updated",
        data: { object: { id: "sub_multi_switch", status: "active", items: { data: [{ price: { id: priceId } }] } } },
      });
      handleStripeWebhook(db, payload, signPayload(payload), SECRET);
      expect(getSubscription(db, session)?.planId).toBe(expectedPlan);
      expect(getSubscription(db, session)?.id).toBe(originalId);
    }
  });

  it("leaves planId untouched when the reported price isn't recognized by this environment's config", async () => {
    const db = createTestDb();
    const session = await newBusiness(db);
    upsertSubscription(db, session.businessId, { planId: "growth", status: "active", providerSubscriptionId: "sub_unknown_price" });

    const payload = JSON.stringify({
      type: "customer.subscription.updated",
      data: { object: { id: "sub_unknown_price", status: "active", items: { data: [{ price: { id: "price_from_a_different_stripe_account" } }] } } },
    });
    handleStripeWebhook(db, payload, signPayload(payload), SECRET);

    expect(getSubscription(db, session)?.planId).toBe("growth");
  });
});

describe("handleStripeWebhook — idempotency (exact replay)", () => {
  it("is idempotent against an exact replay of the same checkout.session.completed event", async () => {
    const db = createTestDb();
    const session = await newBusiness(db);
    upsertSubscription(db, session.businessId, { planId: "growth", status: "incomplete" });

    const payload = JSON.stringify({
      id: "evt_replay_test_1",
      created: NOW_SECONDS,
      type: "checkout.session.completed",
      data: {
        object: { customer: "cus_replay", subscription: "sub_replay", metadata: { businessId: session.businessId, planId: "growth" } },
      },
    });

    handleStripeWebhook(db, payload, signPayload(payload), SECRET);
    const afterFirst = getSubscription(db, session);

    handleStripeWebhook(db, payload, signPayload(payload), SECRET); // Stripe redelivers the exact same event.
    const afterSecond = getSubscription(db, session);

    expect(afterSecond).toEqual(afterFirst);
    expect(afterSecond?.lastWebhookEventId).toBe("evt_replay_test_1");
  });

  it("is idempotent against an exact replay of the same customer.subscription.updated event", async () => {
    const db = createTestDb();
    const session = await newBusiness(db);
    upsertSubscription(db, session.businessId, {
      planId: "starter",
      status: "trialing",
      providerSubscriptionId: "sub_idempotency_check",
    });

    const payload = JSON.stringify({
      id: "evt_replay_test_2",
      created: NOW_SECONDS,
      type: "customer.subscription.updated",
      data: { object: { id: "sub_idempotency_check", status: "active" } },
    });

    handleStripeWebhook(db, payload, signPayload(payload), SECRET);
    handleStripeWebhook(db, payload, signPayload(payload), SECRET); // redelivered

    expect(getSubscription(db, session)?.status).toBe("active");
    expect(getSubscription(db, session)?.lastWebhookEventId).toBe("evt_replay_test_2");
  });

  it("still applies a genuinely NEW event after a previous one, rather than treating every event after the first as a duplicate", async () => {
    const db = createTestDb();
    const session = await newBusiness(db);
    upsertSubscription(db, session.businessId, {
      planId: "starter",
      status: "trialing",
      providerSubscriptionId: "sub_sequence_check",
    });

    const first = JSON.stringify({
      id: "evt_sequence_1",
      created: NOW_SECONDS,
      type: "customer.subscription.updated",
      data: { object: { id: "sub_sequence_check", status: "active" } },
    });
    const second = JSON.stringify({
      id: "evt_sequence_2",
      created: NOW_SECONDS + 1,
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_sequence_check", status: "canceled" } },
    });

    handleStripeWebhook(db, first, signPayload(first), SECRET);
    expect(getSubscription(db, session)?.status).toBe("active");

    handleStripeWebhook(db, second, signPayload(second), SECRET);
    expect(getSubscription(db, session)?.status).toBe("canceled");
  });
});

describe("handleStripeWebhook — out-of-order event protection (distinct events, not just exact replays)", () => {
  it("rejects a late-arriving OLDER event that would otherwise stomp already-applied newer state", async () => {
    const db = createTestDb();
    const session = await newBusiness(db);
    upsertSubscription(db, session.businessId, {
      planId: "starter",
      status: "trialing",
      providerSubscriptionId: "sub_out_of_order",
    });

    const newer = JSON.stringify({
      id: "evt_newer",
      created: NOW_SECONDS + 100,
      type: "customer.subscription.updated",
      data: { object: { id: "sub_out_of_order", status: "active" } },
    });
    handleStripeWebhook(db, newer, signPayload(newer), SECRET);
    expect(getSubscription(db, session)?.status).toBe("active");

    // A DIFFERENT, OLDER event (lower `created`) arrives late — e.g. a
    // retried delivery that took an unusually long path. Its id doesn't
    // match the last-applied event, so exact-replay detection alone
    // wouldn't catch this; the `created` comparison must.
    const older = JSON.stringify({
      id: "evt_older_delayed",
      created: NOW_SECONDS + 50,
      type: "customer.subscription.updated",
      data: { object: { id: "sub_out_of_order", status: "past_due" } },
    });
    handleStripeWebhook(db, older, signPayload(older), SECRET);

    // Still "active" — the older event must NOT have overwritten it.
    expect(getSubscription(db, session)?.status).toBe("active");
    expect(getSubscription(db, session)?.lastWebhookEventId).toBe("evt_newer");
  });

  it("still applies events in correct chronological order regardless of arrival order gaps", async () => {
    const db = createTestDb();
    const session = await newBusiness(db);
    upsertSubscription(db, session.businessId, {
      planId: "starter",
      status: "trialing",
      providerSubscriptionId: "sub_chronological",
    });

    const events = [
      { id: "evt_c1", created: NOW_SECONDS + 10, status: "active" },
      { id: "evt_c2", created: NOW_SECONDS + 20, status: "past_due" },
      { id: "evt_c3", created: NOW_SECONDS + 30, status: "canceled" },
    ];
    for (const e of events) {
      const type = e.status === "canceled" ? "customer.subscription.deleted" : "customer.subscription.updated";
      const payload = JSON.stringify({ id: e.id, created: e.created, type, data: { object: { id: "sub_chronological", status: e.status } } });
      handleStripeWebhook(db, payload, signPayload(payload), SECRET);
    }

    expect(getSubscription(db, session)?.status).toBe("canceled");
    expect(getSubscription(db, session)?.lastWebhookEventId).toBe("evt_c3");
  });

  it("does not apply the ordering check when a hand-built test event has no `created` field (back-compat)", async () => {
    const db = createTestDb();
    const session = await newBusiness(db);
    upsertSubscription(db, session.businessId, {
      planId: "starter",
      status: "trialing",
      providerSubscriptionId: "sub_no_created_field",
    });

    const payload = JSON.stringify({
      type: "customer.subscription.updated",
      data: { object: { id: "sub_no_created_field", status: "active" } },
    });
    expect(() => handleStripeWebhook(db, payload, signPayload(payload), SECRET)).not.toThrow();
    expect(getSubscription(db, session)?.status).toBe("active");
  });
});

describe("handleStripeWebhook — one-time professional installation payment (checkout.session.completed, payment mode)", () => {
  beforeEach(() => {
    process.env.STRIPE_PRICE_INSTALLATION = "price_test_installation";
  });
  afterEach(() => {
    delete process.env.STRIPE_PRICE_INSTALLATION;
    vi.restoreAllMocks();
  });

  async function pendingInstallationCharge(db: ReturnType<typeof createTestDb>, email?: string) {
    const session = await newBusiness(db, email);
    const billing = await import("../billing");
    vi.spyOn(billing, "createCheckoutSession").mockResolvedValue({
      id: "cs_test_installation",
      url: "https://checkout.stripe.example/cs_test_installation",
    });
    await createInstallationCheckoutSession(db, session, { successUrl: "https://x/s", cancelUrl: "https://x/c" });
    const charge = listBillingCharges(db, session)[0]!;
    return { session, charge };
  }

  it("marks the billing charge paid, storing the payment_intent id, and never touches the subscriptions table", async () => {
    const db = createTestDb();
    const { session, charge } = await pendingInstallationCharge(db);
    const subscriptionBefore = getSubscription(db, session);

    const payload = JSON.stringify({
      id: "evt_install_paid_1",
      type: "checkout.session.completed",
      data: {
        object: {
          payment_intent: "pi_test_paid_1",
          metadata: { businessId: session.businessId, billingChargeId: charge.id, kind: "website_installation" },
        },
      },
    });
    handleStripeWebhook(db, payload, signPayload(payload), SECRET);

    const updated = listBillingCharges(db, session)[0]!;
    expect(updated.status).toBe("paid");
    expect(updated.providerChargeId).toBe("pi_test_paid_1");
    expect(getSubscription(db, session)).toEqual(subscriptionBefore);
  });

  it("does not mark it paid if the metadata's businessId doesn't match the charge's actual owner (tampered/foreign metadata)", async () => {
    const db = createTestDb();
    const { charge } = await pendingInstallationCharge(db);

    const payload = JSON.stringify({
      id: "evt_install_tampered",
      type: "checkout.session.completed",
      data: {
        object: { payment_intent: "pi_test_tampered", metadata: { businessId: "biz_someone_else", billingChargeId: charge.id } },
      },
    });
    handleStripeWebhook(db, payload, signPayload(payload), SECRET);

    const { getBillingChargeById } = await import("../repositories/billingCharges");
    expect(getBillingChargeById(db, charge.id)?.status).toBe("pending");
  });

  it("is idempotent — replaying the same paid event does not error or double-apply", async () => {
    const db = createTestDb();
    const { session, charge } = await pendingInstallationCharge(db);

    const payload = JSON.stringify({
      id: "evt_install_paid_replay",
      type: "checkout.session.completed",
      data: {
        object: {
          payment_intent: "pi_test_replay",
          metadata: { businessId: session.businessId, billingChargeId: charge.id },
        },
      },
    });
    handleStripeWebhook(db, payload, signPayload(payload), SECRET);
    handleStripeWebhook(db, payload, signPayload(payload), SECRET);

    const updated = listBillingCharges(db, session)[0]!;
    expect(updated.status).toBe("paid");
    expect(updated.providerChargeId).toBe("pi_test_replay");
  });

  it("cross-tenant: Business B's webhook payload can never mark Business A's charge paid", async () => {
    const db = createTestDb();
    const { charge: chargeA } = await pendingInstallationCharge(db, "install-a@sparkle.example");
    const sessionB = await newBusiness(db, "install-b@sparkle.example");
    chooseSelfInstall(db, sessionB); // Business B has its own, unrelated, already-resolved charge.

    // A payload claiming Business B's id but referencing Business A's real charge id.
    const payload = JSON.stringify({
      id: "evt_cross_tenant",
      type: "checkout.session.completed",
      data: { object: { payment_intent: "pi_cross", metadata: { businessId: sessionB.businessId, billingChargeId: chargeA.id } } },
    });
    handleStripeWebhook(db, payload, signPayload(payload), SECRET);

    const { getBillingChargeById } = await import("../repositories/billingCharges");
    expect(getBillingChargeById(db, chargeA.id)?.status).toBe("pending"); // untouched
  });

  it("never marks an already-paid or waived charge paid again from a later stray event", async () => {
    const db = createTestDb();
    const session = await newBusiness(db);
    const charge = chooseSelfInstall(db, session); // status "waived", amountCents 0

    const payload = JSON.stringify({
      id: "evt_stray",
      type: "checkout.session.completed",
      data: { object: { payment_intent: "pi_stray", metadata: { businessId: session.businessId, billingChargeId: charge.id } } },
    });
    handleStripeWebhook(db, payload, signPayload(payload), SECRET);

    const { getBillingChargeById } = await import("../repositories/billingCharges");
    expect(getBillingChargeById(db, charge.id)?.status).toBe("waived");
  });
});
