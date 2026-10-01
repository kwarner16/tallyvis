import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { useTestDb } from "./testHarness";
import { signUp } from "../services/auth";
import { createCustomerForBusiness } from "../services/customers";
import { getCustomerById } from "../repositories/customers";
import { verifyTwilioWebhookSignature } from "../notifications/sms/verifyWebhookSignature";
import { handleTwilioSmsWebhook, TwilioWebhookVerificationError } from "../services/smsWebhooks";

const getDb = useTestDb();

/**
 * STOP/START synchronization (see docs/decisions/0032-sms-stop-start-sync.md).
 * No real Twilio-signed request has been received in this environment —
 * these tests verify the signature algorithm against Twilio's own
 * documented construction (same caveat `billingWebhooks.test.ts` already
 * carries for Stripe) and the opt-out/opt-in handling against Twilio's
 * documented inbound-message payload shape, not a live integration.
 */

const AUTH_TOKEN = "test_auth_token_for_unit_tests_only";
const URL = "https://app.tallyvis.com/api/webhooks/twilio-sms";

function signTwilioParams(url: string, params: Record<string, string>, authToken = AUTH_TOKEN): string {
  let data = url;
  for (const key of Object.keys(params).sort()) data += key + params[key];
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

function rawBody(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

async function newBusiness(email = "owner@sparkle.example") {
  const db = getDb();
  const { session } = await signUp(db, { businessName: "Sparkle Windows", ownerEmail: email, password: "correct-horse-battery" });
  return { db, session };
}

describe("verifyTwilioWebhookSignature", () => {
  const params = { From: "+15550007777", To: "+18005551234", Body: "STOP" };

  it("accepts a correctly signed payload", () => {
    expect(verifyTwilioWebhookSignature(URL, params, signTwilioParams(URL, params), AUTH_TOKEN)).toBe(true);
  });

  it("rejects a payload signed with the wrong auth token", () => {
    expect(verifyTwilioWebhookSignature(URL, params, signTwilioParams(URL, params, "wrong_token"), AUTH_TOKEN)).toBe(false);
  });

  it("rejects when the params don't match what was signed (tampered body)", () => {
    const signature = signTwilioParams(URL, params);
    expect(verifyTwilioWebhookSignature(URL, { ...params, Body: "START" }, signature, AUTH_TOKEN)).toBe(false);
  });

  it("rejects when the URL doesn't match what was signed", () => {
    const signature = signTwilioParams(URL, params);
    expect(verifyTwilioWebhookSignature(`${URL}/evil`, params, signature, AUTH_TOKEN)).toBe(false);
  });

  it("rejects a missing/empty signature header", () => {
    expect(verifyTwilioWebhookSignature(URL, params, "", AUTH_TOKEN)).toBe(false);
  });
});

describe("handleTwilioSmsWebhook — signature verification", () => {
  it("throws TwilioWebhookVerificationError for a spoofed signature, and makes no database change", async () => {
    const { db, session } = await newBusiness();
    const customer = await createCustomerForBusiness(db, session.businessId, {
      name: "Jordan Rivera",
      email: "jordan@example.com",
      phone: "555-000-8001",
      smsConsent: true,
    });

    const params = { From: "+15550008001", Body: "STOP" };
    await expect(
      handleTwilioSmsWebhook(db, rawBody(params), "not-a-real-signature", URL, AUTH_TOKEN),
    ).rejects.toThrow(TwilioWebhookVerificationError);

    const reloaded = await getCustomerById(db, session.businessId, customer.id);
    expect(reloaded!.smsConsent).toBe(true); // untouched — the unverified request was never processed
  });

  it("throws TwilioWebhookVerificationError when the signature header is missing entirely", async () => {
    const { db } = await newBusiness();
    const params = { From: "+15550008002", Body: "STOP" };
    await expect(handleTwilioSmsWebhook(db, rawBody(params), null, URL, AUTH_TOKEN)).rejects.toThrow(
      TwilioWebhookVerificationError,
    );
  });
});

describe("handleTwilioSmsWebhook — STOP", () => {
  it("flips smsConsent to false and stamps sms_opted_out_at, while preserving the original opt-in evidence", async () => {
    const { db, session } = await newBusiness();
    const customer = await createCustomerForBusiness(db, session.businessId, {
      name: "Jordan Rivera",
      email: "jordan@example.com",
      phone: "555-000-8101",
      smsConsent: true,
    });
    const originalConsentAt = customer.smsConsentAt;
    const originalSource = customer.smsConsentSource;

    const params = { From: "+15550008101", Body: "stop" }; // lowercase — matched case-insensitively
    const signature = signTwilioParams(URL, params);
    const result = await handleTwilioSmsWebhook(db, rawBody(params), signature, URL, AUTH_TOKEN);
    expect(result).toBe("opted-out");

    const reloaded = await getCustomerById(db, session.businessId, customer.id);
    expect(reloaded!.smsConsent).toBe(false);
    expect(reloaded!.smsOptedOutAt).toBeTruthy();
    expect(reloaded!.smsConsentAt).toBe(originalConsentAt); // audit evidence survives
    expect(reloaded!.smsConsentSource).toBe(originalSource);
  });

  it("applies the opt-out GLOBALLY across every business sharing that phone number (one shared Twilio resource)", async () => {
    const { db, session: businessA } = await newBusiness("owner-a@example.com");
    const { session: businessB } = await signUp(db, {
      businessName: "Shiny Panes",
      ownerEmail: "owner-b@example.com",
      password: "correct-horse-battery",
    });
    const customerA = await createCustomerForBusiness(db, businessA.businessId, {
      name: "Jordan Rivera",
      email: "jordan@example.com",
      phone: "555-000-8102",
      smsConsent: true,
    });
    const customerB = await createCustomerForBusiness(db, businessB.businessId, {
      name: "Jordan Rivera",
      email: "jordan@other-example.com",
      phone: "(555) 000-8102",
      smsConsent: true,
    });

    const params = { From: "+15550008102", Body: "STOP" };
    await handleTwilioSmsWebhook(db, rawBody(params), signTwilioParams(URL, params), URL, AUTH_TOKEN);

    expect((await getCustomerById(db, businessA.businessId, customerA.id))!.smsConsent).toBe(false);
    expect((await getCustomerById(db, businessB.businessId, customerB.id))!.smsConsent).toBe(false);
  });

  it("a duplicate STOP is safe/idempotent — same end state, no error", async () => {
    const { db, session } = await newBusiness();
    const customer = await createCustomerForBusiness(db, session.businessId, {
      name: "Jordan Rivera",
      email: "jordan@example.com",
      phone: "555-000-8103",
      smsConsent: true,
    });

    const params = { From: "+15550008103", Body: "STOP" };
    const signature = signTwilioParams(URL, params);
    await handleTwilioSmsWebhook(db, rawBody(params), signature, URL, AUTH_TOKEN);
    const second = await handleTwilioSmsWebhook(db, rawBody(params), signature, URL, AUTH_TOKEN);

    expect(second).toBe("opted-out");
    const reloaded = await getCustomerById(db, session.businessId, customer.id);
    expect(reloaded!.smsConsent).toBe(false);
  });

  it("a STOP from a phone number matching no customer is a safe no-op", async () => {
    const { db } = await newBusiness();
    const params = { From: "+15559999999", Body: "STOP" };
    const result = await handleTwilioSmsWebhook(db, rawBody(params), signTwilioParams(URL, params), URL, AUTH_TOKEN);
    expect(result).toBe("ignored");
  });
});

describe("handleTwilioSmsWebhook — START / re-opt-in", () => {
  async function optedOutCustomer(phone: string) {
    const { db, session } = await newBusiness(`owner-${phone}@example.com`);
    const customer = await createCustomerForBusiness(db, session.businessId, {
      name: "Jordan Rivera",
      email: "jordan@example.com",
      phone,
      smsConsent: true,
    });
    const stopParams = { From: `+1${phone.replace(/\D/g, "")}`, Body: "STOP" };
    await handleTwilioSmsWebhook(db, rawBody(stopParams), signTwilioParams(URL, stopParams), URL, AUTH_TOKEN);
    return { db, session, customer };
  }

  it("restores smsConsent and stamps sms_reopted_in_at for a previously opted-out customer", async () => {
    const { db, session, customer } = await optedOutCustomer("555-000-8201");

    const startParams = { From: "+15550008201", Body: "START" };
    const result = await handleTwilioSmsWebhook(db, rawBody(startParams), signTwilioParams(URL, startParams), URL, AUTH_TOKEN);
    expect(result).toBe("reopted-in");

    const reloaded = await getCustomerById(db, session.businessId, customer.id);
    expect(reloaded!.smsConsent).toBe(true);
    expect(reloaded!.smsReoptedInAt).toBeTruthy();
    expect(reloaded!.smsOptedOutAt).toBeTruthy(); // the opt-out event itself stays on record too
  });

  it("a duplicate START is safe/idempotent", async () => {
    const { db, session, customer } = await optedOutCustomer("555-000-8202");
    const startParams = { From: "+15550008202", Body: "START" };
    const signature = signTwilioParams(URL, startParams);

    await handleTwilioSmsWebhook(db, rawBody(startParams), signature, URL, AUTH_TOKEN);
    const second = await handleTwilioSmsWebhook(db, rawBody(startParams), signature, URL, AUTH_TOKEN);

    expect(second).toBe("reopted-in");
    expect((await getCustomerById(db, session.businessId, customer.id))!.smsConsent).toBe(true);
  });

  it("a bare START from a customer who never opted in does NOT manufacture consent", async () => {
    const { db, session } = await newBusiness();
    const customer = await createCustomerForBusiness(db, session.businessId, {
      name: "Jordan Rivera",
      email: "jordan@example.com",
      phone: "555-000-8203",
      smsConsent: false, // never checked the box
    });

    const params = { From: "+15550008203", Body: "YES" }; // a recognized default START keyword
    const result = await handleTwilioSmsWebhook(db, rawBody(params), signTwilioParams(URL, params), URL, AUTH_TOKEN);
    expect(result).toBe("ignored");

    const reloaded = await getCustomerById(db, session.businessId, customer.id);
    expect(reloaded!.smsConsent).toBe(false);
    expect(reloaded!.smsReoptedInAt).toBeUndefined();
  });

  it("a START from a phone number matching no customer at all is a safe no-op", async () => {
    const { db } = await newBusiness();
    const params = { From: "+15558888888", Body: "START" };
    const result = await handleTwilioSmsWebhook(db, rawBody(params), signTwilioParams(URL, params), URL, AUTH_TOKEN);
    expect(result).toBe("ignored");
  });
});

describe("handleTwilioSmsWebhook — HELP and unrelated inbound text", () => {
  it("HELP never alters consent state", async () => {
    const { db, session } = await newBusiness();
    const customer = await createCustomerForBusiness(db, session.businessId, {
      name: "Jordan Rivera",
      email: "jordan@example.com",
      phone: "555-000-8301",
      smsConsent: true,
    });

    const params = { From: "+15550008301", Body: "HELP" };
    const result = await handleTwilioSmsWebhook(db, rawBody(params), signTwilioParams(URL, params), URL, AUTH_TOKEN);
    expect(result).toBe("ignored");

    const reloaded = await getCustomerById(db, session.businessId, customer.id);
    expect(reloaded!.smsConsent).toBe(true);
  });

  it("an arbitrary unrelated inbound message never alters consent state", async () => {
    const { db, session } = await newBusiness();
    const customer = await createCustomerForBusiness(db, session.businessId, {
      name: "Jordan Rivera",
      email: "jordan@example.com",
      phone: "555-000-8302",
      smsConsent: true,
    });

    const params = { From: "+15550008302", Body: "What time will you arrive tomorrow?" };
    const result = await handleTwilioSmsWebhook(db, rawBody(params), signTwilioParams(URL, params), URL, AUTH_TOKEN);
    expect(result).toBe("ignored");

    const reloaded = await getCustomerById(db, session.businessId, customer.id);
    expect(reloaded!.smsConsent).toBe(true);
  });
});
