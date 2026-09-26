import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "./testHarness";
import { signUp } from "../services/auth";
import { verifyStripeWebhookSignature } from "../billing/verifyWebhookSignature";
import { handleStripeWebhook, WebhookVerificationError } from "../services/billingWebhooks";
import { getSubscription, chooseSelfInstall, createInstallationCheckoutSession, listBillingCharges } from "../services/subscriptions";
import { startTrial } from "../services/subscriptions";
import { upsertSubscription } from "../repositories/subscriptions";
import type { Queryable } from "../db/pg/client";

const getDb = useTestDb();

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

async function newBusiness(db: Queryable, email = "owner@sparkle.example") {
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
    const db = getDb();
    const session = await newBusiness(db);
    await startTrial(db, session, "starter");
    const before = await getSubscription(db, session);

    const payload = JSON.stringify({
      type: "checkout.session.completed",
      data: { object: { customer: "cus_x", subscription: "sub_x", metadata: { businessId: session.businessId } } },
    });

    await expect(handleStripeWebhook(db, payload, "t=1,v1=not-a-real-signature", SECRET)).rejects.toThrow(
      WebhookVerificationError,
    );
    expect(await getSubscription(db, session)).toEqual(before);
  });

  it("links the Stripe customer/subscription ids WITHOUT forcing status to active (regression: this used to hardcode active even for a trialing subscription)", async () => {
    const db = getDb();
    const session = await newBusiness(db);
    // Simulate the real production path: createCheckoutSessionForPlan leaves status "incomplete" pending a webhook.
    await upsertSubscription(db, session.businessId, { planId: "growth", status: "incomplete" });

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

    await handleStripeWebhook(db, payload, signPayload(payload), SECRET);

    const subscription = (await getSubscription(db, session))!;
    // Status is untouched by this event — still "incomplete" until
    // customer.subscription.created (below) supplies the real status.
    expect(subscription.status).toBe("incomplete");
    expect(subscription.billingCustomerId).toBe("cus_abc123");
    expect(subscription.providerSubscriptionId).toBe("sub_abc123");
  });

  it("ignores a checkout.session.completed event with no businessId in metadata (not one of ours)", async () => {
    const db = getDb();
    const payload = JSON.stringify({
      type: "checkout.session.completed",
      data: { object: { customer: "cus_x", subscription: "sub_x", metadata: {} } },
    });
    await expect(handleStripeWebhook(db, payload, signPayload(payload), SECRET)).resolves.not.toThrow();
  });
});

describe("handleStripeWebhook — customer.subscription.created (fixes the status-mapping bug)", () => {
  it("sets status to trialing when Stripe reports the new subscription as trialing", async () => {
    const db = getDb();
    const session = await newBusiness(db);
    await upsertSubscription(db, session.businessId, {
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
    await handleStripeWebhook(db, payload, signPayload(payload), SECRET);

    expect((await getSubscription(db, session))?.status).toBe("trialing");
  });

  it("the full realistic sequence — checkout.session.completed then customer.subscription.created — ends up trialing, never incorrectly active", async () => {
    const db = getDb();
    const session = await newBusiness(db);
    await upsertSubscription(db, session.businessId, { planId: "pro", status: "incomplete" });

    const checkoutPayload = JSON.stringify({
      id: "evt_seq_checkout",
      created: NOW_SECONDS,
      type: "checkout.session.completed",
      data: {
        object: { customer: "cus_seq", subscription: "sub_seq", metadata: { businessId: session.businessId, planId: "pro" } },
      },
    });
    await handleStripeWebhook(db, checkoutPayload, signPayload(checkoutPayload), SECRET);
    expect((await getSubscription(db, session))?.status).toBe("incomplete");

    const subCreatedPayload = JSON.stringify({
      id: "evt_seq_sub_created",
      created: NOW_SECONDS + 1,
      type: "customer.subscription.created",
      data: { object: { id: "sub_seq", status: "trialing" } },
    });
    await handleStripeWebhook(db, subCreatedPayload, signPayload(subCreatedPayload), SECRET);

    const final = (await getSubscription(db, session))!;
    expect(final.status).toBe("trialing");
    expect(final.billingCustomerId).toBe("cus_seq");
    expect(final.providerSubscriptionId).toBe("sub_seq");
  });

  it("REVERSED order — customer.subscription.created arrives BEFORE checkout.session.completed — still resolves via the subscription's own metadata.businessId, never silently dropped (2026-09 production incident: Stripe does not guarantee delivery order across different event types, only same-object events are best-effort ordered)", async () => {
    const db = getDb();
    const session = await newBusiness(db);
    await upsertSubscription(db, session.businessId, { planId: "pro", status: "incomplete" });

    // No checkout.session.completed has been processed yet, so
    // provider_subscription_id is still unset on this row — the ONLY way
    // to resolve it is the subscription object's own
    // subscription_data.metadata.businessId (see billing/providers/stripe.ts).
    const subCreatedFirst = JSON.stringify({
      id: "evt_reversed_sub_created",
      created: NOW_SECONDS,
      type: "customer.subscription.created",
      data: {
        object: { id: "sub_reversed", status: "trialing", metadata: { businessId: session.businessId, planId: "pro" } },
      },
    });
    await handleStripeWebhook(db, subCreatedFirst, signPayload(subCreatedFirst), SECRET);

    const afterFirstEvent = (await getSubscription(db, session))!;
    expect(afterFirstEvent.status).toBe("trialing");
    // Backfilled by the fallback path, so every LATER event for this same
    // subscription is found directly by id, not by repeating the fallback.
    expect(afterFirstEvent.providerSubscriptionId).toBe("sub_reversed");

    // checkout.session.completed arrives second — must not regress
    // anything the fallback already correctly resolved.
    const checkoutSecond = JSON.stringify({
      id: "evt_reversed_checkout",
      created: NOW_SECONDS + 1,
      type: "checkout.session.completed",
      data: {
        object: {
          customer: "cus_reversed",
          subscription: "sub_reversed",
          metadata: { businessId: session.businessId, planId: "pro" },
        },
      },
    });
    await handleStripeWebhook(db, checkoutSecond, signPayload(checkoutSecond), SECRET);

    const final = (await getSubscription(db, session))!;
    expect(final.status).toBe("trialing");
    expect(final.billingCustomerId).toBe("cus_reversed");
    expect(final.providerSubscriptionId).toBe("sub_reversed");
  });

  it("does NOT use the metadata fallback when the event's subscription id already matches an existing row by id — no redundant write", async () => {
    const db = getDb();
    const session = await newBusiness(db);
    await upsertSubscription(db, session.businessId, {
      planId: "growth",
      status: "incomplete",
      providerSubscriptionId: "sub_already_known",
    });

    // Deliberately WRONG businessId in metadata — if the fallback were
    // used here despite the id already matching, this would prove it by
    // resolving to the wrong result. It must not even be consulted.
    const payload = JSON.stringify({
      id: "evt_no_fallback_needed",
      created: NOW_SECONDS,
      type: "customer.subscription.updated",
      data: { object: { id: "sub_already_known", status: "active", metadata: { businessId: "business_nonexistent" } } },
    });
    await handleStripeWebhook(db, payload, signPayload(payload), SECRET);

    expect((await getSubscription(db, session))?.status).toBe("active");
  });

  it("persists Stripe's own trial_start/trial_end onto our row (regression: these were never written for a real webhook-driven subscription, so the dashboard's 'X of 7 days remaining' UI silently showed nothing for every real customer)", async () => {
    const db = getDb();
    const session = await newBusiness(db);
    await upsertSubscription(db, session.businessId, {
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
    await handleStripeWebhook(db, payload, signPayload(payload), SECRET);

    const updated = (await getSubscription(db, session))!;
    expect(updated.trialStartedAt).toBe(new Date(trialStartSeconds * 1000).toISOString());
    expect(updated.trialEndsAt).toBe(new Date(trialEndSeconds * 1000).toISOString());
  });
});

describe("handleStripeWebhook — customer.subscription.updated / .deleted", () => {
  it("syncs status to canceled on customer.subscription.deleted", async () => {
    const db = getDb();
    const session = await newBusiness(db);
    await startTrial(db, session, "starter");
    await upsertSubscription(db, session.businessId, {
      planId: "starter",
      status: "active",
      providerSubscriptionId: "sub_to_cancel",
    });

    const payload = JSON.stringify({
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_to_cancel", status: "canceled" } },
    });
    await handleStripeWebhook(db, payload, signPayload(payload), SECRET);

    expect((await getSubscription(db, session))?.status).toBe("canceled");
  });

  it("maps Stripe's past_due status to still-active internal access", async () => {
    const db = getDb();
    const session = await newBusiness(db);
    await upsertSubscription(db, session.businessId, {
      planId: "starter",
      status: "active",
      providerSubscriptionId: "sub_past_due",
    });

    const payload = JSON.stringify({
      type: "customer.subscription.updated",
      data: { object: { id: "sub_past_due", status: "past_due" } },
    });
    await handleStripeWebhook(db, payload, signPayload(payload), SECRET);

    expect((await getSubscription(db, session))?.status).toBe("active");
  });

  it("maps unpaid/incomplete_expired/paused to expired (denies access)", async () => {
    const db = getDb();
    for (const [stripeStatus, subId] of [
      ["unpaid", "sub_unpaid"],
      ["incomplete_expired", "sub_incomplete_expired"],
      ["paused", "sub_paused"],
    ] as const) {
      const session = await newBusiness(db, `owner-${stripeStatus}@sparkle.example`);
      await upsertSubscription(db, session.businessId, { planId: "starter", status: "active", providerSubscriptionId: subId });

      const payload = JSON.stringify({ type: "customer.subscription.updated", data: { object: { id: subId, status: stripeStatus } } });
      await handleStripeWebhook(db, payload, signPayload(payload), SECRET);

      expect((await getSubscription(db, session))?.status).toBe("expired");
    }
  });

  it("does nothing for a subscription-updated event referencing an id we don't have on file", async () => {
    const db = getDb();
    const payload = JSON.stringify({
      type: "customer.subscription.updated",
      data: { object: { id: "sub_unknown_to_us", status: "active" } },
    });
    await expect(handleStripeWebhook(db, payload, signPayload(payload), SECRET)).resolves.not.toThrow();
  });

  it("ignores an event type this app doesn't handle, without throwing (e.g. invoice.paid, invoice.payment_failed)", async () => {
    const db = getDb();
    for (const type of ["invoice.paid", "invoice.payment_failed", "checkout.session.expired"]) {
      const payload = JSON.stringify({ type, data: { object: { id: "in_123" } } });
      await expect(handleStripeWebhook(db, payload, signPayload(payload), SECRET)).resolves.not.toThrow();
    }
  });

  it("rejects a malformed (non-JSON) payload with a clean error, never a crash — signature is checked first, so a validly-signed non-JSON body still fails safely", async () => {
    const db = getDb();
    const malformed = "{not valid json";
    await expect(handleStripeWebhook(db, malformed, signPayload(malformed), SECRET)).rejects.toThrow();
  });
});

describe("handleStripeWebhook — scheduled cancellation (Customer Portal 'cancel at period end')", () => {
  it("persists cancel_at_period_end + cancel_at WITHOUT changing status or revoking access — scheduling a cancellation is not the same as canceling", async () => {
    const db = getDb();
    const session = await newBusiness(db);
    await upsertSubscription(db, session.businessId, { planId: "growth", status: "active", providerSubscriptionId: "sub_scheduled" });

    const cancelAtSeconds = NOW_SECONDS + 5 * 24 * 60 * 60;
    const payload = JSON.stringify({
      id: "evt_schedule_cancel",
      created: NOW_SECONDS,
      type: "customer.subscription.updated",
      data: { object: { id: "sub_scheduled", status: "active", cancel_at_period_end: true, cancel_at: cancelAtSeconds } },
    });
    await handleStripeWebhook(db, payload, signPayload(payload), SECRET);

    const updated = (await getSubscription(db, session))!;
    expect(updated.status).toBe("active"); // access unaffected
    expect(updated.cancelAtPeriodEnd).toBe(true);
    expect(updated.cancelAt).toBe(new Date(cancelAtSeconds * 1000).toISOString());
  });

  it("scheduling cancellation during a trial does not end the trial or change trial dates", async () => {
    const db = getDb();
    const session = await newBusiness(db);
    const original = await startTrial(db, session, "growth");
    await upsertSubscription(db, session.businessId, { planId: "growth", status: "trialing", providerSubscriptionId: "sub_trial_scheduled" });

    const cancelAtSeconds = NOW_SECONDS + 3 * 24 * 60 * 60;
    const payload = JSON.stringify({
      id: "evt_schedule_trial_cancel",
      created: NOW_SECONDS,
      type: "customer.subscription.updated",
      data: { object: { id: "sub_trial_scheduled", status: "trialing", cancel_at_period_end: true, cancel_at: cancelAtSeconds } },
    });
    await handleStripeWebhook(db, payload, signPayload(payload), SECRET);

    const updated = (await getSubscription(db, session))!;
    expect(updated.status).toBe("trialing");
    expect(updated.cancelAtPeriodEnd).toBe(true);
    expect(updated.trialStartedAt).toBe(original.trialStartedAt);
    expect(updated.trialEndsAt).toBe(original.trialEndsAt);
  });

  it("reactivation (cancel_at_period_end back to false) clears cancel_at, not just the boolean", async () => {
    const db = getDb();
    const session = await newBusiness(db);
    await upsertSubscription(db, session.businessId, {
      planId: "growth",
      status: "active",
      providerSubscriptionId: "sub_reactivated",
      cancelAtPeriodEnd: true,
      cancelAt: new Date(NOW_SECONDS * 1000).toISOString(),
    });

    const payload = JSON.stringify({
      id: "evt_reactivate",
      created: NOW_SECONDS + 1,
      type: "customer.subscription.updated",
      data: { object: { id: "sub_reactivated", status: "active", cancel_at_period_end: false, cancel_at: null } },
    });
    await handleStripeWebhook(db, payload, signPayload(payload), SECRET);

    const updated = (await getSubscription(db, session))!;
    expect(updated.cancelAtPeriodEnd).toBe(false);
    expect(updated.cancelAt).toBeUndefined();
  });

  it("actual cancellation (customer.subscription.deleted) clears any scheduled-cancellation state rather than leaving it stale", async () => {
    const db = getDb();
    const session = await newBusiness(db);
    await upsertSubscription(db, session.businessId, {
      planId: "growth",
      status: "active",
      providerSubscriptionId: "sub_now_deleted",
      cancelAtPeriodEnd: true,
      cancelAt: new Date(NOW_SECONDS * 1000).toISOString(),
    });

    const payload = JSON.stringify({
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_now_deleted", status: "canceled", cancel_at_period_end: true, cancel_at: NOW_SECONDS } },
    });
    await handleStripeWebhook(db, payload, signPayload(payload), SECRET);

    const updated = (await getSubscription(db, session))!;
    expect(updated.status).toBe("canceled");
    expect(updated.cancelAtPeriodEnd).toBe(false);
    expect(updated.cancelAt).toBeUndefined();
  });

  it("canceled_at clears back to undefined once a later event reports no cancellation — not just cancel_at_period_end/cancel_at (2026-09 incident: a real production subscription stayed stuck showing a stale cancellation timestamp forever after reactivation, even though status/cancel_at_period_end correctly recovered)", async () => {
    const db = getDb();
    const session = await newBusiness(db);
    await upsertSubscription(db, session.businessId, { planId: "pro", status: "trialing", providerSubscriptionId: "sub_stale_canceled_at" });

    // First event: cancellation requested (canceled_at set), matching the
    // real Stripe payload shape observed in production — cancel_at_period_end
    // can legitimately read false in the same instant canceled_at is set.
    const firstEvent = JSON.stringify({
      id: "evt_cancel_requested",
      created: NOW_SECONDS,
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_stale_canceled_at",
          status: "trialing",
          cancel_at_period_end: false,
          canceled_at: NOW_SECONDS,
        },
      },
    });
    await handleStripeWebhook(db, firstEvent, signPayload(firstEvent), SECRET);
    expect((await getSubscription(db, session))!.canceledAt).toBeTruthy();

    // Second, later event: Stripe confirms reactivation — canceled_at is
    // genuinely null again. Without the fix, COALESCE(NULL, canceled_at)
    // would keep the stale timestamp from the first event forever.
    const secondEvent = JSON.stringify({
      id: "evt_reactivated_for_real",
      created: NOW_SECONDS + 42,
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_stale_canceled_at",
          status: "trialing",
          cancel_at_period_end: false,
          canceled_at: null,
        },
      },
    });
    await handleStripeWebhook(db, secondEvent, signPayload(secondEvent), SECRET);

    const updated = (await getSubscription(db, session))!;
    expect(updated.status).toBe("trialing");
    expect(updated.canceledAt).toBeUndefined();
    expect(updated.lastWebhookEventId).toBe("evt_reactivated_for_real");
  });

  it("an event with no opinion about cancel_at_period_end (omitted from the payload) leaves the existing scheduled state untouched", async () => {
    const db = getDb();
    const session = await newBusiness(db);
    const scheduledAt = new Date(NOW_SECONDS * 1000).toISOString();
    await upsertSubscription(db, session.businessId, {
      planId: "growth",
      status: "active",
      providerSubscriptionId: "sub_untouched",
      cancelAtPeriodEnd: true,
      cancelAt: scheduledAt,
    });

    // A hand-built payload that simply omits the field, unlike a real Stripe
    // payload (which always includes it) — proving the repository-level
    // COALESCE preserves state when a caller truly has no opinion, even
    // though in practice every real webhook branch always passes it explicitly.
    const payload = JSON.stringify({
      id: "evt_no_opinion",
      created: NOW_SECONDS + 1,
      type: "customer.subscription.updated",
      data: { object: { id: "sub_untouched", status: "past_due" } },
    });
    await handleStripeWebhook(db, payload, signPayload(payload), SECRET);

    const updated = (await getSubscription(db, session))!;
    expect(updated.status).toBe("active"); // past_due maps to active
    expect(updated.cancelAtPeriodEnd).toBe(true);
    expect(updated.cancelAt).toBe(scheduledAt);
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
    const db = getDb();
    const session = await newBusiness(db);
    const original = await startTrial(db, session, "growth");
    await upsertSubscription(db, session.businessId, { planId: "growth", status: "trialing", providerSubscriptionId: "sub_switch" });

    const payload = JSON.stringify({
      id: "evt_switch_1",
      created: NOW_SECONDS,
      type: "customer.subscription.updated",
      data: { object: { id: "sub_switch", status: "trialing", items: { data: [{ price: { id: "price_test_pro" } }] } } },
    });
    await handleStripeWebhook(db, payload, signPayload(payload), SECRET);

    const after = (await getSubscription(db, session))!;
    expect(after.planId).toBe("pro");
    // Switching plans must never reset the trial clock.
    expect(after.trialStartedAt).toBe(original.trialStartedAt);
    expect(after.trialEndsAt).toBe(original.trialEndsAt);
  });

  it("Pro -> Starter -> Growth: each switch updates planId without creating a second subscription row", async () => {
    const db = getDb();
    const session = await newBusiness(db);
    await startTrial(db, session, "pro");
    await upsertSubscription(db, session.businessId, { planId: "pro", status: "active", providerSubscriptionId: "sub_multi_switch" });
    const originalId = (await getSubscription(db, session))!.id;

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
      await handleStripeWebhook(db, payload, signPayload(payload), SECRET);
      expect((await getSubscription(db, session))?.planId).toBe(expectedPlan);
      expect((await getSubscription(db, session))?.id).toBe(originalId);
    }
  });

  it("leaves planId untouched when the reported price isn't recognized by this environment's config", async () => {
    const db = getDb();
    const session = await newBusiness(db);
    await upsertSubscription(db, session.businessId, { planId: "growth", status: "active", providerSubscriptionId: "sub_unknown_price" });

    const payload = JSON.stringify({
      type: "customer.subscription.updated",
      data: { object: { id: "sub_unknown_price", status: "active", items: { data: [{ price: { id: "price_from_a_different_stripe_account" } }] } } },
    });
    await handleStripeWebhook(db, payload, signPayload(payload), SECRET);

    expect((await getSubscription(db, session))?.planId).toBe("growth");
  });
});

describe("handleStripeWebhook — idempotency (exact replay)", () => {
  it("is idempotent against an exact replay of the same checkout.session.completed event", async () => {
    const db = getDb();
    const session = await newBusiness(db);
    await upsertSubscription(db, session.businessId, { planId: "growth", status: "incomplete" });

    const payload = JSON.stringify({
      id: "evt_replay_test_1",
      created: NOW_SECONDS,
      type: "checkout.session.completed",
      data: {
        object: { customer: "cus_replay", subscription: "sub_replay", metadata: { businessId: session.businessId, planId: "growth" } },
      },
    });

    await handleStripeWebhook(db, payload, signPayload(payload), SECRET);
    const afterFirst = await getSubscription(db, session);

    await handleStripeWebhook(db, payload, signPayload(payload), SECRET); // Stripe redelivers the exact same event.
    const afterSecond = await getSubscription(db, session);

    expect(afterSecond).toEqual(afterFirst);
    expect(afterSecond?.lastWebhookEventId).toBe("evt_replay_test_1");
  });

  it("is idempotent against an exact replay of the same customer.subscription.updated event", async () => {
    const db = getDb();
    const session = await newBusiness(db);
    await upsertSubscription(db, session.businessId, {
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

    await handleStripeWebhook(db, payload, signPayload(payload), SECRET);
    await handleStripeWebhook(db, payload, signPayload(payload), SECRET); // redelivered

    expect((await getSubscription(db, session))?.status).toBe("active");
    expect((await getSubscription(db, session))?.lastWebhookEventId).toBe("evt_replay_test_2");
  });

  it("still applies a genuinely NEW event after a previous one, rather than treating every event after the first as a duplicate", async () => {
    const db = getDb();
    const session = await newBusiness(db);
    await upsertSubscription(db, session.businessId, {
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

    await handleStripeWebhook(db, first, signPayload(first), SECRET);
    expect((await getSubscription(db, session))?.status).toBe("active");

    await handleStripeWebhook(db, second, signPayload(second), SECRET);
    expect((await getSubscription(db, session))?.status).toBe("canceled");
  });
});

describe("handleStripeWebhook — out-of-order event protection (distinct events, not just exact replays)", () => {
  it("rejects a late-arriving OLDER event that would otherwise stomp already-applied newer state", async () => {
    const db = getDb();
    const session = await newBusiness(db);
    await upsertSubscription(db, session.businessId, {
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
    await handleStripeWebhook(db, newer, signPayload(newer), SECRET);
    expect((await getSubscription(db, session))?.status).toBe("active");

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
    await handleStripeWebhook(db, older, signPayload(older), SECRET);

    // Still "active" — the older event must NOT have overwritten it.
    expect((await getSubscription(db, session))?.status).toBe("active");
    expect((await getSubscription(db, session))?.lastWebhookEventId).toBe("evt_newer");
  });

  it("still applies events in correct chronological order regardless of arrival order gaps", async () => {
    const db = getDb();
    const session = await newBusiness(db);
    await upsertSubscription(db, session.businessId, {
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
      await handleStripeWebhook(db, payload, signPayload(payload), SECRET);
    }

    expect((await getSubscription(db, session))?.status).toBe("canceled");
    expect((await getSubscription(db, session))?.lastWebhookEventId).toBe("evt_c3");
  });

  it("does not apply the ordering check when a hand-built test event has no `created` field (back-compat)", async () => {
    const db = getDb();
    const session = await newBusiness(db);
    await upsertSubscription(db, session.businessId, {
      planId: "starter",
      status: "trialing",
      providerSubscriptionId: "sub_no_created_field",
    });

    const payload = JSON.stringify({
      type: "customer.subscription.updated",
      data: { object: { id: "sub_no_created_field", status: "active" } },
    });
    await expect(handleStripeWebhook(db, payload, signPayload(payload), SECRET)).resolves.not.toThrow();
    expect((await getSubscription(db, session))?.status).toBe("active");
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

  async function pendingInstallationCharge(db: Queryable, email?: string) {
    const session = await newBusiness(db, email);
    const billing = await import("../billing");
    vi.spyOn(billing, "createCheckoutSession").mockResolvedValue({
      id: "cs_test_installation",
      url: "https://checkout.stripe.example/cs_test_installation",
    });
    await createInstallationCheckoutSession(db, session, { successUrl: "https://x/s", cancelUrl: "https://x/c" });
    const charges = await listBillingCharges(db, session);
    const charge = charges[0]!;
    return { session, charge };
  }

  it("marks the billing charge paid, storing the payment_intent id, and never touches the subscriptions table", async () => {
    const db = getDb();
    const { session, charge } = await pendingInstallationCharge(db);
    const subscriptionBefore = await getSubscription(db, session);

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
    await handleStripeWebhook(db, payload, signPayload(payload), SECRET);

    const updated = (await listBillingCharges(db, session))[0]!;
    expect(updated.status).toBe("paid");
    expect(updated.providerChargeId).toBe("pi_test_paid_1");
    expect(await getSubscription(db, session)).toEqual(subscriptionBefore);
  });

  it("does not mark it paid if the metadata's businessId doesn't match the charge's actual owner (tampered/foreign metadata)", async () => {
    const db = getDb();
    const { charge } = await pendingInstallationCharge(db);

    const payload = JSON.stringify({
      id: "evt_install_tampered",
      type: "checkout.session.completed",
      data: {
        object: { payment_intent: "pi_test_tampered", metadata: { businessId: "biz_someone_else", billingChargeId: charge.id } },
      },
    });
    await handleStripeWebhook(db, payload, signPayload(payload), SECRET);

    const { getBillingChargeById } = await import("../repositories/billingCharges");
    expect((await getBillingChargeById(db, charge.id))?.status).toBe("pending");
  });

  it("is idempotent — replaying the same paid event does not error or double-apply", async () => {
    const db = getDb();
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
    await handleStripeWebhook(db, payload, signPayload(payload), SECRET);
    await handleStripeWebhook(db, payload, signPayload(payload), SECRET);

    const updated = (await listBillingCharges(db, session))[0]!;
    expect(updated.status).toBe("paid");
    expect(updated.providerChargeId).toBe("pi_test_replay");
  });

  it("cross-tenant: Business B's webhook payload can never mark Business A's charge paid", async () => {
    const db = getDb();
    const { charge: chargeA } = await pendingInstallationCharge(db, "install-a@sparkle.example");
    const sessionB = await newBusiness(db, "install-b@sparkle.example");
    await chooseSelfInstall(db, sessionB); // Business B has its own, unrelated, already-resolved charge.

    // A payload claiming Business B's id but referencing Business A's real charge id.
    const payload = JSON.stringify({
      id: "evt_cross_tenant",
      type: "checkout.session.completed",
      data: { object: { payment_intent: "pi_cross", metadata: { businessId: sessionB.businessId, billingChargeId: chargeA.id } } },
    });
    await handleStripeWebhook(db, payload, signPayload(payload), SECRET);

    const { getBillingChargeById } = await import("../repositories/billingCharges");
    expect((await getBillingChargeById(db, chargeA.id))?.status).toBe("pending"); // untouched
  });

  it("never marks an already-paid or waived charge paid again from a later stray event", async () => {
    const db = getDb();
    const session = await newBusiness(db);
    const charge = await chooseSelfInstall(db, session); // status "waived", amountCents 0

    const payload = JSON.stringify({
      id: "evt_stray",
      type: "checkout.session.completed",
      data: { object: { payment_intent: "pi_stray", metadata: { businessId: session.businessId, billingChargeId: charge.id } } },
    });
    await handleStripeWebhook(db, payload, signPayload(payload), SECRET);

    const { getBillingChargeById } = await import("../repositories/billingCharges");
    expect((await getBillingChargeById(db, charge.id))?.status).toBe("waived");
  });
});
