import { describe, expect, it } from "vitest";
import { createTestDb } from "../db/client";
import { signUp } from "../services/auth";
import { createQuote, getQuote, updateQuoteStatus } from "../services/quotes";
import {
  acceptQuoteByToken,
  declineQuoteByToken,
  generateShareLink,
  getQuoteByShareToken,
  getShareLinkStatus,
  requestQuoteChangesByToken,
  revokeShareLink,
} from "../services/quoteSharing";

/**
 * Phase 10: secure customer quote sharing. See
 * docs/decisions/0012-secure-quote-sharing.md. Covers the share-token
 * mechanism itself (generate/regenerate/revoke, resolution, expiry) and
 * every public customer action it gates — with particular attention to the
 * negative/security cases: the raw token is the entire authorization
 * credential, so nothing else a caller supplies should matter.
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

const quoteInput = (email = "jane@example.com") => ({
  customer: { name: "Jane Smith", email, phone: "(555) 111-2222" },
  property: { propertyType: "single-family" as const, stories: 1 },
  servicePreferences,
  notes: "",
  photos: [],
  analysis,
});

async function setUpBusinessWithQuote(status: "new" | "sent" = "sent") {
  const db = createTestDb();
  const { session } = await signUp(db, {
    businessName: "Sparkle Windows",
    ownerEmail: "owner@sparkle.example",
    password: "correct-horse-battery",
  });
  let quote = createQuote(db, session, quoteInput());
  if (status === "sent") {
    quote = updateQuoteStatus(db, session, quote.id, "needs_review");
    quote = updateQuoteStatus(db, session, quote.id, "approved");
    quote = updateQuoteStatus(db, session, quote.id, "sent");
  }
  return { db, session, quote };
}

async function setUpTwoBusinesses() {
  const db = createTestDb();
  const a = await signUp(db, { businessName: "A Co", ownerEmail: "a@example.com", password: "password-aaa" });
  const b = await signUp(db, { businessName: "B Co", ownerEmail: "b@example.com", password: "password-bbb" });
  return { db, sessionA: a.session, sessionB: b.session };
}

describe("generateShareLink / getShareLinkStatus / revokeShareLink — business-side management", () => {
  it("reports no active link before one is generated", async () => {
    const { db, session, quote } = await setUpBusinessWithQuote();
    expect(getShareLinkStatus(db, session, quote.id)).toEqual({ active: false });
  });

  it("generating a link makes it active, with a createdAt/expiresAt and no way to read the raw token back", async () => {
    const { db, session, quote } = await setUpBusinessWithQuote();
    const result = generateShareLink(db, session, quote.id);

    expect(result.token.length).toBeGreaterThan(20);
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(new Date(result.createdAt).getTime());

    const status = getShareLinkStatus(db, session, quote.id);
    expect(status).toEqual({ active: true, createdAt: result.createdAt, expiresAt: result.expiresAt });
    expect(status).not.toHaveProperty("token");
  });

  it("never stores the raw token in the database — only its hash", async () => {
    const { db, session, quote } = await setUpBusinessWithQuote();
    const { token } = generateShareLink(db, session, quote.id);

    const row = db.prepare("SELECT token_hash FROM quote_share_tokens WHERE quote_id = ?").get(quote.id) as {
      token_hash: string;
    };
    expect(row.token_hash).not.toBe(token);
    expect(row.token_hash).not.toContain(token);
    expect(row.token_hash).toHaveLength(64); // hex-encoded SHA-256
  });

  it("regenerating (calling generate again) revokes the old token and issues a new, different one", async () => {
    const { db, session, quote } = await setUpBusinessWithQuote();
    const first = generateShareLink(db, session, quote.id);
    const second = generateShareLink(db, session, quote.id);

    expect(second.token).not.toBe(first.token);
    expect(getQuoteByShareToken(db, first.token)).toBeUndefined();
    expect(getQuoteByShareToken(db, second.token)?.quote.id).toBe(quote.id);

    const activeRows = db
      .prepare("SELECT COUNT(*) c FROM quote_share_tokens WHERE quote_id = ? AND revoked_at IS NULL")
      .get(quote.id) as { c: number };
    expect(activeRows.c).toBe(1);
  });

  it("revoking an active link makes it stop working immediately", async () => {
    const { db, session, quote } = await setUpBusinessWithQuote();
    const { token } = generateShareLink(db, session, quote.id);
    expect(getQuoteByShareToken(db, token)).toBeDefined();

    revokeShareLink(db, session, quote.id);

    expect(getQuoteByShareToken(db, token)).toBeUndefined();
    expect(getShareLinkStatus(db, session, quote.id)).toEqual({ active: false });
  });

  it("revoking with no active link is a harmless no-op, not an error", async () => {
    const { db, session, quote } = await setUpBusinessWithQuote();
    expect(() => revokeShareLink(db, session, quote.id)).not.toThrow();
  });

  it("business A cannot manage business B's share link", async () => {
    const { db, sessionA, sessionB } = await setUpTwoBusinesses();
    const quoteB = createQuote(db, sessionB, quoteInput());

    expect(() => generateShareLink(db, sessionA, quoteB.id)).toThrow(/not found/);
    expect(() => getShareLinkStatus(db, sessionA, quoteB.id)).toThrow(/not found/);
    expect(() => revokeShareLink(db, sessionA, quoteB.id)).toThrow(/not found/);
  });

  it("business A cannot revoke business B's active share link by guessing the quote id", async () => {
    const { db, sessionA, sessionB } = await setUpTwoBusinesses();
    const quoteB = createQuote(db, sessionB, quoteInput());
    const { token } = generateShareLink(db, sessionB, quoteB.id);

    expect(() => revokeShareLink(db, sessionA, quoteB.id)).toThrow(/not found/);
    // Business B's link is completely unaffected by A's attempt.
    expect(getQuoteByShareToken(db, token)?.quote.id).toBe(quoteB.id);
  });

  it("a forged/nonexistent quote id is rejected the same way as someone else's real quote", async () => {
    const { db, session } = await setUpBusinessWithQuote();
    expect(() => generateShareLink(db, session, "quote_does-not-exist")).toThrow(/not found/);
  });
});

describe("getQuoteByShareToken — public resolution", () => {
  it("a valid token resolves to exactly its own quote and business", async () => {
    const { db, session, quote } = await setUpBusinessWithQuote();
    const { token } = generateShareLink(db, session, quote.id);

    const result = getQuoteByShareToken(db, token);
    expect(result?.quote.id).toBe(quote.id);
    expect(result?.business.name).toBe("Sparkle Windows");
    expect(result?.expiresAt).toBeTruthy();
  });

  it("returns only the business fields the public page actually needs — never the owner's login email or other internal fields", async () => {
    const { db, session, quote } = await setUpBusinessWithQuote();
    const { token } = generateShareLink(db, session, quote.id);

    const result = getQuoteByShareToken(db, token)!;
    expect(Object.keys(result.business).sort()).toEqual(["name", "phone"]);
    expect(JSON.stringify(result.business)).not.toContain("owner@sparkle.example");
    expect(JSON.stringify(result.business)).not.toContain(session.businessId);
  });

  it("records first/last viewed timestamps on resolution", async () => {
    const { db, session, quote } = await setUpBusinessWithQuote();
    const { token } = generateShareLink(db, session, quote.id);
    expect(getQuote(db, session, quote.id)!.firstViewedAt).toBeUndefined();

    getQuoteByShareToken(db, token);
    const afterFirstView = getQuote(db, session, quote.id)!;
    expect(afterFirstView.firstViewedAt).toBeTruthy();
    expect(afterFirstView.lastViewedAt).toBe(afterFirstView.firstViewedAt);

    getQuoteByShareToken(db, token);
    const afterSecondView = getQuote(db, session, quote.id)!;
    // first_viewed_at never moves once set.
    expect(afterSecondView.firstViewedAt).toBe(afterFirstView.firstViewedAt);
  });

  it("an unknown/random token resolves to nothing", async () => {
    const db = createTestDb();
    expect(getQuoteByShareToken(db, "totally-made-up-token-that-was-never-issued")).toBeUndefined();
  });

  it("an empty-string token resolves to nothing", async () => {
    const db = createTestDb();
    expect(getQuoteByShareToken(db, "")).toBeUndefined();
  });

  it("token for Quote A cannot resolve Quote B — every token is bound to exactly one quote", async () => {
    const { db, session } = await setUpBusinessWithQuote();
    const quoteA = createQuote(db, session, quoteInput("a@example.com"));
    const quoteB = createQuote(db, session, quoteInput("b@example.com"));
    const { token: tokenA } = generateShareLink(db, session, quoteA.id);

    const result = getQuoteByShareToken(db, tokenA);
    expect(result?.quote.id).toBe(quoteA.id);
    expect(result?.quote.id).not.toBe(quoteB.id);
  });

  it("a revoked token no longer resolves", async () => {
    const { db, session, quote } = await setUpBusinessWithQuote();
    const { token } = generateShareLink(db, session, quote.id);
    revokeShareLink(db, session, quote.id);

    expect(getQuoteByShareToken(db, token)).toBeUndefined();
  });

  it("an expired token no longer resolves", async () => {
    const { db, session, quote } = await setUpBusinessWithQuote();
    const { token } = generateShareLink(db, session, quote.id);

    db.prepare("UPDATE quote_share_tokens SET expires_at = ? WHERE quote_id = ?").run(
      new Date(Date.now() - 1000).toISOString(),
      quote.id,
    );

    expect(getQuoteByShareToken(db, token)).toBeUndefined();
  });

  it("does not expose unrelated customers, other quotes, or password/session data", async () => {
    const { db, session, quote } = await setUpBusinessWithQuote();
    // A second, unrelated quote/customer for the same business.
    createQuote(db, session, quoteInput("someone-else@example.com"));
    const { token } = generateShareLink(db, session, quote.id);

    const result = getQuoteByShareToken(db, token)!;
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("someone-else@example.com");
    expect(serialized.toLowerCase()).not.toContain("password");
    expect(serialized).not.toContain("token_hash");
    // Only the one quote this token grants access to comes back — never a list.
    expect(Array.isArray((result as unknown as { quotes?: unknown }).quotes)).toBe(false);
  });
});

describe("acceptQuoteByToken / declineQuoteByToken", () => {
  it("a valid token can accept its own quote", async () => {
    const { db, session, quote } = await setUpBusinessWithQuote("sent");
    const { token } = generateShareLink(db, session, quote.id);

    const updated = acceptQuoteByToken(db, token);
    expect(updated.status).toBe("accepted");
    expect(updated.acceptedAt).toBeTruthy();
    expect(getQuote(db, session, quote.id)!.status).toBe("accepted");
  });

  it("a valid token can decline its own quote", async () => {
    const { db, session, quote } = await setUpBusinessWithQuote("sent");
    const { token } = generateShareLink(db, session, quote.id);

    const updated = declineQuoteByToken(db, token);
    expect(updated.status).toBe("declined");
    expect(updated.declinedAt).toBeTruthy();
  });

  it("an invalid token cannot accept or decline anything", async () => {
    const db = createTestDb();
    expect(() => acceptQuoteByToken(db, "not-a-real-token")).toThrow(/invalid or has expired/);
    expect(() => declineQuoteByToken(db, "not-a-real-token")).toThrow(/invalid or has expired/);
  });

  it("a revoked token cannot accept or decline", async () => {
    const { db, session, quote } = await setUpBusinessWithQuote("sent");
    const { token } = generateShareLink(db, session, quote.id);
    revokeShareLink(db, session, quote.id);

    expect(() => acceptQuoteByToken(db, token)).toThrow(/invalid or has expired/);
    expect(getQuote(db, session, quote.id)!.status).toBe("sent");
  });

  it("rejects accepting/declining a quote that isn't in a status the transition graph allows (invalid transition enforced server-side)", async () => {
    const { db, session, quote } = await setUpBusinessWithQuote("new"); // status "new", not "sent"
    const { token } = generateShareLink(db, session, quote.id);

    expect(() => acceptQuoteByToken(db, token)).toThrow(/can no longer be accepted/);
    expect(getQuote(db, session, quote.id)!.status).toBe("new");
  });

  it("prevents a double-accept — accepted is terminal", async () => {
    const { db, session, quote } = await setUpBusinessWithQuote("sent");
    const { token } = generateShareLink(db, session, quote.id);

    acceptQuoteByToken(db, token);
    expect(() => acceptQuoteByToken(db, token)).toThrow(/can no longer be accepted/);
    expect(() => declineQuoteByToken(db, token)).toThrow(/can no longer be declined/);
  });

  it("a customer action cannot target a different quote than the one the token was issued for", async () => {
    const { db, session } = await setUpBusinessWithQuote();
    let quoteA = createQuote(db, session, quoteInput("a@example.com"));
    quoteA = updateQuoteStatus(db, session, quoteA.id, "needs_review");
    quoteA = updateQuoteStatus(db, session, quoteA.id, "approved");
    quoteA = updateQuoteStatus(db, session, quoteA.id, "sent");
    let quoteB = createQuote(db, session, quoteInput("b@example.com"));
    quoteB = updateQuoteStatus(db, session, quoteB.id, "needs_review");
    quoteB = updateQuoteStatus(db, session, quoteB.id, "approved");
    quoteB = updateQuoteStatus(db, session, quoteB.id, "sent");

    const { token: tokenA } = generateShareLink(db, session, quoteA.id);

    // There is no quoteId parameter to substitute — accepting only ever
    // acts on whatever quote tokenA itself resolves to.
    acceptQuoteByToken(db, tokenA);

    expect(getQuote(db, session, quoteA.id)!.status).toBe("accepted");
    expect(getQuote(db, session, quoteB.id)!.status).toBe("sent"); // untouched
  });

  it("cross-business: token issued by business A cannot be used to accept/decline business B's quote even with a colliding scenario", async () => {
    const { db, sessionA, sessionB } = await setUpTwoBusinesses();
    let quoteA = createQuote(db, sessionA, quoteInput());
    quoteA = updateQuoteStatus(db, sessionA, quoteA.id, "needs_review");
    quoteA = updateQuoteStatus(db, sessionA, quoteA.id, "approved");
    quoteA = updateQuoteStatus(db, sessionA, quoteA.id, "sent");
    let quoteB = createQuote(db, sessionB, quoteInput());
    quoteB = updateQuoteStatus(db, sessionB, quoteB.id, "needs_review");
    quoteB = updateQuoteStatus(db, sessionB, quoteB.id, "approved");
    quoteB = updateQuoteStatus(db, sessionB, quoteB.id, "sent");

    const { token: tokenA } = generateShareLink(db, sessionA, quoteA.id);
    const updated = acceptQuoteByToken(db, tokenA);

    expect(updated.businessId).toBe(sessionA.businessId);
    expect(getQuote(db, sessionB, quoteB.id)!.status).toBe("sent"); // business B's quote is untouched
  });
});

describe("requestQuoteChangesByToken", () => {
  it("a valid token can submit a request for changes/contact", async () => {
    const { db, session, quote } = await setUpBusinessWithQuote("sent");
    const { token } = generateShareLink(db, session, quote.id);

    const updated = requestQuoteChangesByToken(db, token, "Could you also quote gutter cleaning?");
    expect(updated.changesRequestedAt).toBeTruthy();
    expect(updated.customerRequestNote).toBe("Could you also quote gutter cleaning?");
    // Requesting changes never transitions status.
    expect(updated.status).toBe("sent");
  });

  it("rejects an empty note", async () => {
    const { db, session, quote } = await setUpBusinessWithQuote("sent");
    const { token } = generateShareLink(db, session, quote.id);
    expect(() => requestQuoteChangesByToken(db, token, "   ")).toThrow(/describe what/);
  });

  it("an invalid token cannot submit a request", async () => {
    const db = createTestDb();
    expect(() => requestQuoteChangesByToken(db, "not-a-real-token", "hello")).toThrow(/invalid or has expired/);
  });

  it("cannot request changes once the quote is already finalized (accepted or declined)", async () => {
    const { db, session, quote } = await setUpBusinessWithQuote("sent");
    const { token } = generateShareLink(db, session, quote.id);
    acceptQuoteByToken(db, token);

    expect(() => requestQuoteChangesByToken(db, token, "one more thing")).toThrow(/already been finalized/);
  });

  it("truncates an excessively long note rather than failing or storing it unbounded", async () => {
    const { db, session, quote } = await setUpBusinessWithQuote("sent");
    const { token } = generateShareLink(db, session, quote.id);
    const huge = "x".repeat(5000);

    const updated = requestQuoteChangesByToken(db, token, huge);
    expect(updated.customerRequestNote!.length).toBeLessThanOrEqual(2000);
  });
});

describe("multi-tenant isolation of the sharing feature end-to-end", () => {
  it("a full cross-tenant attempt — guess a token pattern, act on it, check nothing leaked or changed", async () => {
    const { db, sessionA, sessionB } = await setUpTwoBusinesses();
    let quoteA = createQuote(db, sessionA, quoteInput("victim@example.com"));
    quoteA = updateQuoteStatus(db, sessionA, quoteA.id, "needs_review");
    quoteA = updateQuoteStatus(db, sessionA, quoteA.id, "approved");
    quoteA = updateQuoteStatus(db, sessionA, quoteA.id, "sent");
    const { token: realToken } = generateShareLink(db, sessionA, quoteA.id);

    // Business B has no way to enumerate or forge A's token.
    const guessed = realToken.slice(0, -1) + (realToken.endsWith("A") ? "B" : "A");
    expect(getQuoteByShareToken(db, guessed)).toBeUndefined();
    expect(() => acceptQuoteByToken(db, guessed)).toThrow(/invalid or has expired/);

    // And B's own session can't reach A's quote through the authenticated surface either.
    expect(getQuote(db, sessionB, quoteA.id)).toBeUndefined();
    expect(() => getShareLinkStatus(db, sessionB, quoteA.id)).toThrow(/not found/);

    expect(getQuote(db, sessionA, quoteA.id)!.status).toBe("sent"); // untouched by every attempt above
  });
});
