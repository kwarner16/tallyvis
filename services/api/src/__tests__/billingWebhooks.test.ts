import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createTestDb } from "../db/client";
import { signUp } from "../services/auth";
import { verifyStripeWebhookSignature } from "../billing/verifyWebhookSignature";
import { handleStripeWebhook, WebhookVerificationError } from "../services/billingWebhooks";
import { getSubscription } from "../services/subscriptions";
import { startTrial } from "../services/subscriptions";
import { upsertSubscription } from "../repositories/subscriptions";

/**
 * Phase 14 — reconciling internal subscription state against Stripe (see
 * docs/decisions/0016-onboarding-billing-embed.md). No real Stripe webhook
 * has been received in this environment; these tests verify the signature
 * algorithm against Stripe's own documented construction and the event
 * handling against Stripe's documented payload shape — not a live
 * integration. See the file's own header comment for the same caveat.
 */

const SECRET = "whsec_test_secret_for_unit_tests_only";

function signPayload(payload: string, secret = SECRET, timestamp = Math.floor(Date.now() / 1000)): string {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
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

describe("handleStripeWebhook", () => {
  it("throws WebhookVerificationError and applies nothing for an invalid signature", async () => {
    const db = createTestDb();
    const { session } = await signUp(db, {
      businessName: "Sparkle Windows",
      ownerEmail: "owner@sparkle.example",
      password: "correct-horse-battery",
    });
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

  it("activates the subscription on checkout.session.completed, storing the provider's customer/subscription ids", async () => {
    const db = createTestDb();
    const { session } = await signUp(db, {
      businessName: "Sparkle Windows",
      ownerEmail: "owner@sparkle.example",
      password: "correct-horse-battery",
    });
    startTrial(db, session, "growth");

    const payload = JSON.stringify({
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
    expect(subscription.status).toBe("active");
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

  it("syncs status to canceled on customer.subscription.deleted", async () => {
    const db = createTestDb();
    const { session } = await signUp(db, {
      businessName: "Sparkle Windows",
      ownerEmail: "owner@sparkle.example",
      password: "correct-horse-battery",
    });
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
    const { session } = await signUp(db, {
      businessName: "Sparkle Windows",
      ownerEmail: "owner@sparkle.example",
      password: "correct-horse-battery",
    });
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

  it("does nothing for a subscription-updated event referencing an id we don't have on file", async () => {
    const db = createTestDb();
    const payload = JSON.stringify({
      type: "customer.subscription.updated",
      data: { object: { id: "sub_unknown_to_us", status: "active" } },
    });
    expect(() => handleStripeWebhook(db, payload, signPayload(payload), SECRET)).not.toThrow();
  });

  it("ignores an event type this app doesn't handle, without throwing (e.g. invoice.paid)", async () => {
    const db = createTestDb();
    const payload = JSON.stringify({ type: "invoice.paid", data: { object: { id: "in_123" } } });
    expect(() => handleStripeWebhook(db, payload, signPayload(payload), SECRET)).not.toThrow();
  });

  it("rejects a malformed (non-JSON) payload with a clean error, never a crash — signature is checked first, so a validly-signed non-JSON body still fails safely", async () => {
    const db = createTestDb();
    const malformed = "{not valid json";
    expect(() => handleStripeWebhook(db, malformed, signPayload(malformed), SECRET)).toThrow();
  });

  it("is idempotent against an exact replay of the same checkout.session.completed event (Stripe's documented at-least-once delivery)", async () => {
    const db = createTestDb();
    const { session } = await signUp(db, {
      businessName: "Sparkle Windows",
      ownerEmail: "owner@sparkle.example",
      password: "correct-horse-battery",
    });
    startTrial(db, session, "growth");

    const payload = JSON.stringify({
      id: "evt_replay_test_1",
      type: "checkout.session.completed",
      data: {
        object: {
          customer: "cus_replay",
          subscription: "sub_replay",
          metadata: { businessId: session.businessId, planId: "growth" },
        },
      },
    });

    handleStripeWebhook(db, payload, signPayload(payload), SECRET);
    const afterFirst = getSubscription(db, session);

    // Simulate Stripe redelivering the exact same event a second time.
    handleStripeWebhook(db, payload, signPayload(payload), SECRET);
    const afterSecond = getSubscription(db, session);

    expect(afterSecond).toEqual(afterFirst);
    expect(afterSecond?.lastWebhookEventId).toBe("evt_replay_test_1");
  });

  it("is idempotent against an exact replay of the same customer.subscription.updated event", async () => {
    const db = createTestDb();
    const { session } = await signUp(db, {
      businessName: "Sparkle Windows",
      ownerEmail: "owner@sparkle.example",
      password: "correct-horse-battery",
    });
    upsertSubscription(db, session.businessId, {
      planId: "starter",
      status: "trialing",
      providerSubscriptionId: "sub_idempotency_check",
    });

    const payload = JSON.stringify({
      id: "evt_replay_test_2",
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
    const { session } = await signUp(db, {
      businessName: "Sparkle Windows",
      ownerEmail: "owner@sparkle.example",
      password: "correct-horse-battery",
    });
    upsertSubscription(db, session.businessId, {
      planId: "starter",
      status: "trialing",
      providerSubscriptionId: "sub_sequence_check",
    });

    const first = JSON.stringify({
      id: "evt_sequence_1",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_sequence_check", status: "active" } },
    });
    const second = JSON.stringify({
      id: "evt_sequence_2",
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_sequence_check", status: "canceled" } },
    });

    handleStripeWebhook(db, first, signPayload(first), SECRET);
    expect(getSubscription(db, session)?.status).toBe("active");

    handleStripeWebhook(db, second, signPayload(second), SECRET);
    expect(getSubscription(db, session)?.status).toBe("canceled");
  });
});
