import { describe, expect, it } from "vitest";
import { SMS_CONSENT_DISCLOSURE_VERSION, SMS_CONSENT_SOURCE_PUBLIC_ESTIMATOR } from "@tallyvis/types";
import { useTestDb } from "./testHarness";
import { signUp } from "../services/auth";
import { createCustomerForBusiness, findOrCreateCustomer, isCustomerSmsEligible, updateCustomer } from "../services/customers";
import { createQuotePublic } from "../services/quotes";
import { getCustomerById } from "../repositories/customers";

const getDb = useTestDb();

/**
 * Twilio A2P 10DLC compliance (see
 * docs/decisions/0029-sms-consent-and-a2p-10dlc.md). Covers the task's
 * lettered test scenarios: (A) consent checked, (B) consent declined,
 * (C) no phone number given, (D) a pre-existing/legacy customer with no
 * consent data, (E) a phone number alone never implying consent.
 */

const analysis = {
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
};

const servicePreferences = {
  interiorCleaning: false,
  screens: false,
  tracks: false,
  hardWaterTreatment: "unsure" as const,
};

const publicSubmission = (customer: { name: string; email: string; phone?: string; smsConsent?: boolean }) => ({
  customer,
  property: { propertyType: "single-family" as const, stories: 1, address: "1 Test St" },
  servicePreferences,
  notes: "",
  photos: [],
  analysis,
});

async function setUp() {
  const db = getDb();
  const { session } = await signUp(db, {
    businessName: "Sparkle Windows",
    ownerEmail: "owner@sparkle.example",
    password: "correct-horse-battery",
  });
  return { db, session };
}

describe("createCustomerForBusiness — SMS consent recording (the public estimator's own path)", () => {
  it("A: phone + checked consent -> submission succeeds, consent + timestamp + source + disclosure version are all persisted", async () => {
    const { db, session } = await setUp();
    const before = Date.now();

    const customer = await createCustomerForBusiness(db, session.businessId, {
      name: "Jordan Rivera",
      email: "jordan@example.com",
      phone: "5551234567",
      smsConsent: true,
    });

    expect(customer.smsConsent).toBe(true);
    expect(customer.smsConsentAt).toBeTruthy();
    expect(new Date(customer.smsConsentAt!).getTime()).toBeGreaterThanOrEqual(before);
    expect(customer.smsConsentSource).toBe(SMS_CONSENT_SOURCE_PUBLIC_ESTIMATOR);
    expect(customer.smsConsentDisclosureVersion).toBe(SMS_CONSENT_DISCLOSURE_VERSION);
    expect(isCustomerSmsEligible(customer)).toBe(true);
  });

  it("B: phone provided but consent NOT checked -> submission still succeeds, consent is not granted, not eligible", async () => {
    const { db, session } = await setUp();

    const customer = await createCustomerForBusiness(db, session.businessId, {
      name: "Jordan Rivera",
      email: "jordan@example.com",
      phone: "5551234567",
      smsConsent: false,
    });

    expect(customer.smsConsent).toBe(false);
    expect(customer.smsConsentAt).toBeUndefined();
    expect(customer.smsConsentSource).toBeUndefined();
    expect(isCustomerSmsEligible(customer)).toBe(false);
  });

  it("C: no phone number given, even with consent checked -> consent cannot accidentally be created", async () => {
    const { db, session } = await setUp();

    const customer = await createCustomerForBusiness(db, session.businessId, {
      name: "Jordan Rivera",
      email: "jordan@example.com",
      smsConsent: true,
    });

    expect(customer.phone).toBeUndefined();
    expect(customer.smsConsent).toBe(false);
    expect(customer.smsConsentAt).toBeUndefined();
    expect(isCustomerSmsEligible(customer)).toBe(false);
  });

  it("C (blank phone): an empty/whitespace-only phone string is treated the same as no phone at all", async () => {
    const { db, session } = await setUp();

    const customer = await createCustomerForBusiness(db, session.businessId, {
      name: "Jordan Rivera",
      email: "jordan@example.com",
      phone: "   ",
      smsConsent: true,
    });

    expect(customer.smsConsent).toBe(false);
  });

  it("E: a phone number's mere presence never implies consent when the box wasn't checked", async () => {
    const { db, session } = await setUp();

    const customer = await createCustomerForBusiness(db, session.businessId, {
      name: "Jordan Rivera",
      email: "jordan@example.com",
      phone: "5551234567",
      // smsConsent omitted entirely — simulates a client that never sent the field at all.
    });

    expect(customer.smsConsent).toBe(false);
    expect(isCustomerSmsEligible(customer)).toBe(false);
  });

  it("an authenticated business can never grant SMS consent on a customer's behalf (findOrCreateCustomer)", async () => {
    const { db, session } = await setUp();

    // `smsConsent` is a legitimate field on the shared `CustomerInput` type
    // (any caller may set it), which is exactly why this matters: the
    // SERVER, not the type system, is what must refuse to honor it here.
    const customer = await findOrCreateCustomer(db, session, {
      name: "Jordan Rivera",
      email: "jordan@example.com",
      phone: "5551234567",
      smsConsent: true,
    });

    expect(customer.smsConsent).toBe(false);
    expect(customer.smsConsentAt).toBeUndefined();
  });

  it("editing a customer from the dashboard can never grant or change their SMS consent (updateCustomer)", async () => {
    const { db, session } = await setUp();
    const customer = await findOrCreateCustomer(db, session, { name: "Jordan Rivera", email: "jordan@example.com" });

    const updated = await updateCustomer(db, session, customer.id, {
      name: "Jordan Rivera",
      email: "jordan@example.com",
      phone: "5551234567",
      smsConsent: true,
    });

    expect(updated.smsConsent).toBe(false);
  });
});

describe("isCustomerSmsEligible", () => {
  it("requires both smsConsent=true AND a phone number", () => {
    expect(isCustomerSmsEligible({ smsConsent: true, phone: "+15551234567" })).toBe(true);
    expect(isCustomerSmsEligible({ smsConsent: false, phone: "+15551234567" })).toBe(false);
    expect(isCustomerSmsEligible({ smsConsent: true, phone: undefined })).toBe(false);
    expect(isCustomerSmsEligible({ smsConsent: true, phone: "   " })).toBe(false);
    expect(isCustomerSmsEligible({ smsConsent: false, phone: undefined })).toBe(false);
  });
});

describe("D: a pre-existing customer row with no consent data is treated as not opted in", () => {
  it("a customer row inserted before this migration (no consent columns ever written) reads back as smsConsent: false", async () => {
    const { db, session } = await setUp();
    // Simulates a genuinely legacy row: writes directly via SQL, exactly
    // like the pre-migration `createCustomer` used to, never touching the
    // new consent columns at all (they fall back to the migration's own
    // `DEFAULT false` / NULL, not anything this test sets explicitly).
    await db.query(
      `INSERT INTO customers (id, business_id, name, email, phone, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6)`,
      ["legacy_customer_1", session.businessId, "Legacy Customer", "legacy@example.com", "5550001111", new Date().toISOString()],
    );

    const legacy = await getCustomerById(db, session.businessId, "legacy_customer_1");
    expect(legacy).toBeDefined();
    expect(legacy!.smsConsent).toBe(false);
    expect(legacy!.smsConsentAt).toBeUndefined();
    expect(isCustomerSmsEligible(legacy!)).toBe(false);
  });
});

describe("createQuotePublic — full public-estimator integration", () => {
  it("A: a real quote submission with phone + checked consent persists consent on the created customer", async () => {
    const { db, session } = await setUp();

    const quote = await createQuotePublic(
      db,
      session.businessId,
      publicSubmission({ name: "Jordan Rivera", email: "jordan@example.com", phone: "5551234567", smsConsent: true }),
    );

    expect(quote.customer.smsConsent).toBe(true);
    expect(quote.customer.smsConsentAt).toBeTruthy();
  });

  it("B: a real quote submission with phone but unchecked consent still succeeds, with no consent recorded", async () => {
    const { db, session } = await setUp();

    const quote = await createQuotePublic(
      db,
      session.businessId,
      publicSubmission({ name: "Jordan Rivera", email: "jordan@example.com", phone: "5551234567", smsConsent: false }),
    );

    expect(quote.id).toBeTruthy();
    expect(quote.customer.smsConsent).toBe(false);
  });

  it("C: a real quote submission with no phone number at all succeeds normally and can never carry consent", async () => {
    const { db, session } = await setUp();

    const quote = await createQuotePublic(
      db,
      session.businessId,
      publicSubmission({ name: "Jordan Rivera", email: "jordan@example.com", smsConsent: true }),
    );

    expect(quote.id).toBeTruthy();
    expect(quote.customer.phone).toBeUndefined();
    expect(quote.customer.smsConsent).toBe(false);
  });
});
