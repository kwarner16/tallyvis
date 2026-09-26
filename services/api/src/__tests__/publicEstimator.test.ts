import { describe, expect, it } from "vitest";
import { useTestDb } from "./testHarness";
import { signUp } from "../services/auth";
import { getDefaultPublicBusiness, getCurrentBusiness, resolveEmbedBusiness } from "../services/business";
import { createQuote, createQuotePublic, updateQuotePublic, getQuote, listQuotes } from "../services/quotes";
import { findOrCreateCustomer, listCustomers } from "../services/customers";
import { getActiveConfiguration, saveNewPricingConfigurationVersion } from "../services/pricing";

const getDb = useTestDb();

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
  const db = getDb();
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
    expect((await getDefaultPublicBusiness(db))!.id).toBe(session.businessId);
  });

  it("is undefined before any business exists, so the public wizard fails closed", async () => {
    expect(await getDefaultPublicBusiness(getDb())).toBeUndefined();
  });
});

describe("createQuotePublic customer handling", () => {
  it("never resolves an anonymous submission onto an existing customer record", async () => {
    const { db, session } = await setUp();
    const known = await findOrCreateCustomer(db, session, {
      name: "Jane Smith",
      email: "jane@example.com",
      phone: "(555) 111-2222",
    });

    // A visitor who guesses a real customer's email must learn nothing about them.
    const quote = await createQuotePublic(
      db,
      session.businessId,
      publicSubmission({ name: "Not Jane", email: "jane@example.com" }),
    );

    expect(quote.customerId).not.toBe(known.id);
    expect(quote.customer.name).toBe("Not Jane");
    expect(quote.customer.phone).toBeUndefined();

    // The real record is untouched by the submission.
    const reloadedKnown = (await listCustomers(db, session)).find((c) => c.id === known.id)!;
    expect(reloadedKnown.name).toBe("Jane Smith");
    expect(reloadedKnown.phone).toBe("(555) 111-2222");
  });

  it("does not let a repeated anonymous submission confirm an earlier one exists", async () => {
    const { db, session } = await setUp();
    const first = await createQuotePublic(
      db,
      session.businessId,
      publicSubmission({ name: "Visitor", email: "visitor@example.com" }),
    );
    const second = await createQuotePublic(
      db,
      session.businessId,
      publicSubmission({ name: "Visitor", email: "visitor@example.com" }),
    );

    expect(second.customerId).not.toBe(first.customerId);
  });

  it("still applies the authoritative customer validation", async () => {
    const { db, session } = await setUp();
    await expect(
      createQuotePublic(
        db,
        session.businessId,
        publicSubmission({ name: " ", email: "v@example.com" }),
      ),
    ).rejects.toThrow(/name is required/);
    await expect(
      createQuotePublic(db, session.businessId, publicSubmission({ name: "V", email: "nope" })),
    ).rejects.toThrow(/valid customer email/);
  });

  it("leaves a signed-in business's own create-quote flow reusing customers as before", async () => {
    const { db, session } = await setUp();
    const first = await createQuote(
      db,
      session,
      publicSubmission({ name: "Jordan", email: "jordan@example.com" }),
    );
    const second = await createQuote(
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
    const quote = await createQuotePublic(
      db,
      session.businessId,
      publicSubmission({ name: "Visitor", email: "visitor@example.com" }),
    );

    expect(quote.businessId).toBe(session.businessId);
    expect(await getQuote(db, session, quote.id)).toBeDefined();
    expect(await getQuote(db, otherSession, quote.id)).toBeUndefined();
    expect(await listQuotes(db, otherSession)).toHaveLength(0);
    expect(await listCustomers(db, otherSession)).toHaveLength(0);
  });

  it("prices server-side against the business's current configuration and pins that version", async () => {
    const { db, session } = await setUp();
    const v1 = await getActiveConfiguration(db, session);
    const before = await createQuotePublic(
      db,
      session.businessId,
      publicSubmission({ name: "Early", email: "early@example.com" }),
    );
    expect(before.pricingConfigId).toBe(v1.id);

    const v2 = await saveNewPricingConfigurationVersion(db, session, {
      ...v1.rules,
      basePrice: v1.rules.basePrice + 50,
    });
    const after = await createQuotePublic(
      db,
      session.businessId,
      publicSubmission({ name: "Late", email: "late@example.com" }),
    );

    expect(after.pricingConfigId).toBe(v2.id);
    expect(after.estimate.total).toBeGreaterThan(before.estimate.total);
    // The earlier quote is untouched by the business changing its rates.
    expect((await getQuote(db, session, before.id))!.estimate.total).toBe(before.estimate.total);
  });

  it("starts every publicly submitted quote in the 'new' status", async () => {
    const { db, session } = await setUp();
    const quote = await createQuotePublic(
      db,
      session.businessId,
      publicSubmission({ name: "Visitor", email: "visitor@example.com" }),
    );
    expect(quote.status).toBe("new");
  });
});

/**
 * 2026-09 "lost tenant identity" incident (docs/decisions/0026) — a real
 * production quote landed on an unrelated business's dashboard. These are
 * tenant-isolation SECURITY invariants, not merely UX tests: the full
 * embed-id -> business -> quote -> dashboard chain, exercised with two
 * genuinely distinct real businesses, end to end through the exact
 * functions the production code calls (`resolveEmbedBusiness`,
 * `createQuotePublic`, `updateQuotePublic`, `listQuotes`) — never a
 * shortcut that assumes the resolution step works.
 */
describe("tenant isolation end-to-end (embed A / embed B)", () => {
  it("Business A's embed -> a completed estimate -> the quote belongs to A and appears in A's own dashboard", async () => {
    const { db, session } = await setUp();
    const businessA = await getCurrentBusiness(db, session);

    const resolved = await resolveEmbedBusiness(db, businessA.publicEmbedId);
    expect(resolved?.id).toBe(businessA.id);

    const quote = await createQuotePublic(
      db,
      resolved!.id,
      publicSubmission({ name: "Customer A", email: "customer-a@example.com" }),
    );

    expect(quote.businessId).toBe(businessA.id);
    expect((await listQuotes(db, session)).map((q) => q.id)).toContain(quote.id);
  });

  it("Business B's embed -> a completed estimate -> the quote belongs to B; A cannot see it, B can", async () => {
    const { db, session, otherSession } = await setUp();
    const businessB = await getCurrentBusiness(db, otherSession);

    const resolved = await resolveEmbedBusiness(db, businessB.publicEmbedId);
    expect(resolved?.id).toBe(businessB.id);

    const quote = await createQuotePublic(
      db,
      resolved!.id,
      publicSubmission({ name: "Customer B", email: "customer-b@example.com" }),
    );

    expect(quote.businessId).toBe(businessB.id);
    expect((await listQuotes(db, otherSession)).map((q) => q.id)).toContain(quote.id);
    expect((await listQuotes(db, session)).map((q) => q.id)).not.toContain(quote.id);
    expect(await getQuote(db, session, quote.id)).toBeUndefined();
  });

  it("distinct embed ids for A and B never resolve to each other's business, even when both exist simultaneously", async () => {
    const { db, session, otherSession } = await setUp();
    const businessA = await getCurrentBusiness(db, session);
    const businessB = await getCurrentBusiness(db, otherSession);
    expect(businessA.publicEmbedId).not.toBe(businessB.publicEmbedId);

    expect((await resolveEmbedBusiness(db, businessA.publicEmbedId))?.id).toBe(businessA.id);
    expect((await resolveEmbedBusiness(db, businessB.publicEmbedId))?.id).toBe(businessB.id);
  });

  it("re-analysis (updateQuotePublic) can NEVER reassign a quote to a different real business — ownership is immutable through the public update path", async () => {
    const { db, session, otherSession } = await setUp();
    const businessA = await getCurrentBusiness(db, session);
    const businessB = await getCurrentBusiness(db, otherSession);

    const quote = await createQuotePublic(
      db,
      businessA.id,
      publicSubmission({ name: "Customer A", email: "customer-a@example.com" }),
    );

    // Attempting to "update" it under Business B's resolved identity (e.g.
    // a corrupted/switched embedId mid-session) must be refused outright,
    // never silently move the quote to B.
    await expect(
      updateQuotePublic(db, businessB.id, quote.id, publicSubmission({ name: "Customer A", email: "customer-a@example.com" })),
    ).rejects.toThrow(/quote not found/i);

    // The quote is untouched: still A's, not B's, and B's dashboard never sees it.
    const stillA = await getQuote(db, session, quote.id);
    expect(stillA?.businessId).toBe(businessA.id);
    expect((await listQuotes(db, otherSession)).map((q) => q.id)).not.toContain(quote.id);

    // A legitimate re-analysis under the SAME business (A) still works.
    const updated = await updateQuotePublic(
      db,
      businessA.id,
      quote.id,
      publicSubmission({ name: "Customer A", email: "customer-a@example.com" }),
    );
    expect(updated.businessId).toBe(businessA.id);
  });
});
