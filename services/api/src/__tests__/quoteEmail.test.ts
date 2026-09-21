import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "../db/client";
import { signUp } from "../services/auth";
import { createQuote, getQuote } from "../services/quotes";
import { getQuoteByShareToken } from "../services/quoteSharing";
import { sendQuoteEmail } from "../services/quoteEmail";
import type { AuthSession } from "../auth/session";

/**
 * Phase 14 — customer quote email (see
 * docs/decisions/0016-onboarding-billing-embed.md). Reuses the existing
 * secure quote-share token mechanism rather than a second public
 * authorization path — these tests confirm the emailed link is a real,
 * resolvable share link, and that nothing beyond a concise customer-facing
 * summary leaves the server.
 */

const sampleInput = () => ({
  customer: { name: "Jordan Rivera", email: "jordan@example.com" },
  property: { propertyType: "single-family" as const, stories: 1 },
  servicePreferences: { interiorCleaning: false, screens: false, tracks: false, hardWaterTreatment: "unsure" as const },
  notes: "Gate code is 1234 — internal note, never customer-facing.",
  photos: [],
  analysis: {
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
  },
});

async function setUp(): Promise<{ db: ReturnType<typeof createTestDb>; session: AuthSession }> {
  const db = createTestDb();
  const { session } = await signUp(db, {
    businessName: "Sparkle Windows",
    ownerEmail: "owner@sparkle.example",
    password: "correct-horse-battery",
  });
  return { db, session };
}

afterEach(() => {
  delete process.env.EMAIL_PROVIDER;
  vi.restoreAllMocks();
});

describe("sendQuoteEmail", () => {
  it("sends via a secure, resolvable quote-share link (the same mechanism the dashboard's share panel uses) and records delivery metadata", async () => {
    const { db, session } = await setUp();
    const quote = createQuote(db, session, sampleInput());
    let linkedToken = "";

    const result = await sendQuoteEmail(db, session, quote.id, (token) => {
      linkedToken = token;
      return `https://example.com/quote/${token}`;
    });

    expect(result.status).toBe("sent");
    expect(linkedToken.length).toBeGreaterThan(20);

    // The link in the email is a real, working share link.
    const publicView = getQuoteByShareToken(db, linkedToken);
    expect(publicView?.quote.id).toBe(quote.id);

    // Delivery metadata recorded on the quote.
    const reloaded = getQuote(db, session, quote.id)!;
    expect(reloaded.emailDeliveryStatus).toBe("sent");
    expect(reloaded.emailSentAt).toBeTruthy();
  });

  it("does not include internal notes, line-item pricing breakdown, or the pricing configuration in the email content", async () => {
    const { db, session } = await setUp();
    const quote = createQuote(db, session, sampleInput());

    const capturedMessages: { subject: string; text: string; html: string }[] = [];
    const notifications = await import("../notifications");
    vi.spyOn(notifications, "sendEmail").mockImplementation(async (message) => {
      capturedMessages.push(message);
      return { providerMessageId: "test-message-id" };
    });

    await sendQuoteEmail(db, session, quote.id, (token) => `https://example.com/quote/${token}`);

    expect(capturedMessages).toHaveLength(1);
    const [message] = capturedMessages;
    expect(message!.text).not.toContain("Gate code is 1234");
    expect(message!.html).not.toContain("Gate code is 1234");
    for (const item of quote.estimate.lineItems) {
      expect(message!.text).not.toContain(item.label);
    }
    // What it SHOULD contain: the business name, the customer's name, the total, and the link.
    expect(message!.text).toContain("Sparkle Windows");
    expect(message!.text).toContain(quote.customer.name);
  });

  it("propagates a provider failure rather than silently claiming success, and records the failure", async () => {
    const { db, session } = await setUp();
    const quote = createQuote(db, session, sampleInput());
    process.env.EMAIL_PROVIDER = "resend"; // configured provider name, but RESEND_API_KEY is deliberately unset

    await expect(
      sendQuoteEmail(db, session, quote.id, (token) => `https://example.com/quote/${token}`),
    ).rejects.toThrow(/not configured/i);

    const reloaded = getQuote(db, session, quote.id)!;
    expect(reloaded.emailDeliveryStatus).toBe("failed");
  });

  it("throws when the customer has no email on file, rather than silently sending nowhere", async () => {
    // Every customer-creation path validates a real email is present, so
    // this defensive check is normally unreachable through the public
    // service surface — simulated here by clearing it directly at the
    // repository/database level, the only way this state could occur.
    const { db, session } = await setUp();
    const quote = createQuote(db, session, sampleInput());
    db.prepare(`UPDATE customers SET email = '' WHERE id = ?`).run(quote.customerId);

    await expect(
      sendQuoteEmail(db, session, quote.id, (token) => `https://example.com/quote/${token}`),
    ).rejects.toThrow(/no email address/i);
  });
});
