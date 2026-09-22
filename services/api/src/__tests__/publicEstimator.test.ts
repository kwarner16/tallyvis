import { describe, expect, it } from "vitest";
import { createTestDb } from "../db/client";
import { signUp } from "../services/auth";
import { getDefaultPublicBusiness } from "../services/business";
import { createQuote, createQuotePublic, getQuote, listQuotes } from "../services/quotes";
import { findOrCreateCustomer, listCustomers } from "../services/customers";
import { getActiveConfiguration, saveNewPricingConfigurationVersion } from "../services/pricing";

/**
 * The unauthenticated `/estimate/*` wizard is one of Phase 9's two
 * deliberate exceptions to "every read/write is scoped by a session" (see
 * docs/decisions/0011-persistence-auth-and-multi-tenancy.md). Because it
 * takes input from someone who has proved nothing about who they are, it
 * needs its own coverage: what a visitor can cause, and — more importantly
 * — what a visitor must never be able to learn.
 */

const analysis = {
  characteristics: {
    vertical: "window-cleaning" as const,
    windowCount: 15,
    windowType: "double-hung" as const,
    paneCount: 0,
    stories: 1,
    screens: 4,
    tracks: 4,
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
  screens: true,
  tracks: true,
  hardWaterTreatment: "unsure" as const,
};

const publicSubmission = (customer: { name: string; email: string; phone?: string }) => ({
  customer,
  property: { propertyType: "single-family" as const, stories: 1, address: "1 Test St" },
  servicePreferences,
  notes: "",
  photos: [],
  analysis,
});

async function setUp() {
  const db = createTestDb();
  const first = await signUp(db, {
    businessName: "Sparkle Windows",
    ownerEmail: "owner@sparkle.example",
    password: "correct-horse-battery",
  });
  const second = await signUp(db, {
    businessName: "Rival Windows",
    ownerEmail: "owner@rival.example",
    password: "correct-horse-battery",
  });
  return { db, session: first.session, otherSession: second.session };
}

describe("getDefaultPublicBusiness", () => {
  it("resolves to the business that signed up first (the stated Phase 9 simplification)", async () => {
    const { db, session } = await setUp();
    expect(getDefaultPublicBusiness(db)!.id).toBe(session.businessId);
  });

  it("is undefined before any business exists, so the public wizard fails closed", () => {
    expect(getDefaultPublicBusiness(createTestDb())).toBeUndefined();
  });
});

describe("createQuotePublic customer handling", () => {
  it("never resolves an anonymous submission onto an existing customer record", async () => {
    const { db, session } = await setUp();
    const known = findOrCreateCustomer(db, session, {
      name: "Jane Smith",
      email: "jane@example.com",
      phone: "(555) 111-2222",
    });

    // A visitor who guesses a real customer's email must learn nothing about them.
    const quote = createQuotePublic(
      db,
      session.businessId,
      publicSubmission({ name: "Not Jane", email: "jane@example.com" }),
    );

    expect(quote.customerId).not.toBe(known.id);
    expect(quote.customer.name).toBe("Not Jane");
    expect(quote.customer.phone).toBeUndefined();

    // The real record is untouched by the submission.
    const reloadedKnown = listCustomers(db, session).find((c) => c.id === known.id)!;
    expect(reloadedKnown.name).toBe("Jane Smith");
    expect(reloadedKnown.phone).toBe("(555) 111-2222");
  });

  it("does not let a repeated anonymous submission confirm an earlier one exists", async () => {
    const { db, session } = await setUp();
    const first = createQuotePublic(
      db,
      session.businessId,
      publicSubmission({ name: "Visitor", email: "visitor@example.com" }),
    );
    const second = createQuotePublic(
      db,
      session.businessId,
      publicSubmission({ name: "Visitor", email: "visitor@example.com" }),
    );

    expect(second.customerId).not.toBe(first.customerId);
  });

  it("still applies the authoritative customer validation", async () => {
    const { db, session } = await setUp();
    expect(() =>
      createQuotePublic(
        db,
        session.businessId,
        publicSubmission({ name: " ", email: "v@example.com" }),
      ),
    ).toThrow(/name is required/);
    expect(() =>
      createQuotePublic(db, session.businessId, publicSubmission({ name: "V", email: "nope" })),
    ).toThrow(/valid customer email/);
  });

  it("leaves a signed-in business's own create-quote flow reusing customers as before", async () => {
    const { db, session } = await setUp();
    const first = createQuote(
      db,
      session,
      publicSubmission({ name: "Jordan", email: "jordan@example.com" }),
    );
    const second = createQuote(
      db,
      session,
      publicSubmission({ name: "Jordan", email: "jordan@example.com" }),
    );

    expect(second.customerId).toBe(first.customerId);
  });
});

describe("createQuotePublic tenancy and pricing", () => {
  it("files the quote against the resolved business only — no other tenant can see it", async () => {
    const { db, session, otherSession } = await setUp();
    const quote = createQuotePublic(
      db,
      session.businessId,
      publicSubmission({ name: "Visitor", email: "visitor@example.com" }),
    );

    expect(quote.businessId).toBe(session.businessId);
    expect(getQuote(db, session, quote.id)).toBeDefined();
    expect(getQuote(db, otherSession, quote.id)).toBeUndefined();
    expect(listQuotes(db, otherSession)).toHaveLength(0);
    expect(listCustomers(db, otherSession)).toHaveLength(0);
  });

  it("prices server-side against the business's current configuration and pins that version", async () => {
    const { db, session } = await setUp();
    const v1 = getActiveConfiguration(db, session);
    const before = createQuotePublic(
      db,
      session.businessId,
      publicSubmission({ name: "Early", email: "early@example.com" }),
    );
    expect(before.pricingConfigId).toBe(v1.id);

    const v2 = saveNewPricingConfigurationVersion(db, session, {
      ...v1.rules,
      basePrice: v1.rules.basePrice + 50,
    });
    const after = createQuotePublic(
      db,
      session.businessId,
      publicSubmission({ name: "Late", email: "late@example.com" }),
    );

    expect(after.pricingConfigId).toBe(v2.id);
    expect(after.estimate.total).toBeGreaterThan(before.estimate.total);
    // The earlier quote is untouched by the business changing its rates.
    expect(getQuote(db, session, before.id)!.estimate.total).toBe(before.estimate.total);
  });

  it("starts every publicly submitted quote in the 'new' status", async () => {
    const { db, session } = await setUp();
    const quote = createQuotePublic(
      db,
      session.businessId,
      publicSubmission({ name: "Visitor", email: "visitor@example.com" }),
    );
    expect(quote.status).toBe("new");
  });
});
