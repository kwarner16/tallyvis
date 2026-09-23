import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Regression coverage for the same production bug publicActions.test.ts
 * exists to catch (React error #441 — see actionResult.ts's own comment):
 * quoteActions.ts used to throw for every expected failure (AI-analysis
 * category, quote-email category, validation/not-found/state messages),
 * which a production build strips to a generic digest-only error before
 * the client ever sees the real message. Every exported action here must
 * return an `ActionResult` instead.
 *
 * Both `@tallyvis/api` and `./session` are mocked — this file tests
 * quoteActions.ts's own error-handling/wrapping logic, not business
 * resolution, authorization, or database behavior (already covered by
 * services/api's own test suite against real Postgres).
 */

const mocks = vi.hoisted(() => ({
  createQuote: vi.fn(),
  analyzePropertyForBusiness: vi.fn(),
  updateQuoteAnalysis: vi.fn(),
  recalculateQuoteEstimate: vi.fn(),
  getConfigurationById: vi.fn(),
  updateQuoteCustomer: vi.fn(),
  updateQuoteStatus: vi.fn(),
  getShareLinkStatus: vi.fn(),
  generateShareLink: vi.fn(),
  revokeShareLink: vi.fn(),
  recordJobOutcome: vi.fn(),
  sendQuoteEmail: vi.fn(),
}));

class FakeAiProviderError extends Error {
  category: string;
  constructor(message: string, category: string) {
    super(message);
    this.category = category;
  }
}

class FakeNotificationError extends Error {
  category: string;
  constructor(message: string, category: string) {
    super(message);
    this.category = category;
  }
}

vi.mock("@tallyvis/api", () => ({
  AiProviderError: FakeAiProviderError,
  NotificationError: FakeNotificationError,
  analyzePropertyForBusiness: mocks.analyzePropertyForBusiness,
  createQuote: mocks.createQuote,
  generateShareLink: mocks.generateShareLink,
  getConfigurationById: mocks.getConfigurationById,
  getShareLinkStatus: mocks.getShareLinkStatus,
  recalculateQuoteEstimate: mocks.recalculateQuoteEstimate,
  recordJobOutcome: mocks.recordJobOutcome,
  revokeShareLink: mocks.revokeShareLink,
  sendQuoteEmail: mocks.sendQuoteEmail,
  updateQuoteAnalysis: mocks.updateQuoteAnalysis,
  updateQuoteCustomer: mocks.updateQuoteCustomer,
  updateQuoteStatus: mocks.updateQuoteStatus,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("../session", () => ({
  requireContext: vi.fn(async () => ({ db: {}, session: { businessId: "biz_1", userId: "user_1" } })),
}));

vi.mock("../urls", () => ({ buildQuoteShareUrl: (token: string) => `https://app.tallyvis.com/quote/${token}` }));

const {
  createQuoteAction,
  analyzePropertyAction,
  updateQuoteAnalysisAction,
  recalculateQuoteEstimateAction,
  updateQuoteCustomerAction,
  updateQuoteStatusAction,
  getQuoteShareLinkStatusAction,
  generateQuoteShareLinkAction,
  revokeQuoteShareLinkAction,
  recordJobOutcomeAction,
  sendQuoteEmailAction,
} = await import("../quoteActions");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createQuoteAction", () => {
  it("returns ok:true with the created quote", async () => {
    mocks.createQuote.mockResolvedValue({ id: "quote_1" });
    const result = await createQuoteAction({} as never);
    expect(result).toEqual({ ok: true, data: { id: "quote_1" } });
  });

  it("returns ok:false with the service's own safe validation message — never throws", async () => {
    mocks.createQuote.mockRejectedValue(new Error("Service address is required."));
    const result = await createQuoteAction({} as never);
    expect(result).toEqual({ ok: false, message: "Service address is required." });
  });
});

describe("analyzePropertyAction", () => {
  it("returns ok:true with the analysis result on success", async () => {
    mocks.analyzePropertyForBusiness.mockResolvedValue({ analysis: {}, observation: {} });
    const result = await analyzePropertyAction({ images: [], property: {} });
    expect(result.ok).toBe(true);
  });

  it("returns ok:false with the categorized AI failure message — never the raw provider text", async () => {
    mocks.analyzePropertyForBusiness.mockRejectedValue(new FakeAiProviderError("raw provider detail", "rate-limit"));
    const result = await analyzePropertyAction({ images: [], property: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe("The AI provider is busy right now — please try again in a moment.");
      expect(result.message).not.toContain("raw provider detail");
    }
  });

  it("returns a generic safe message — never throws — for a genuinely unexpected error", async () => {
    mocks.analyzePropertyForBusiness.mockRejectedValue(new Error("ECONNREFUSED 10.0.0.5:5432"));
    const result = await analyzePropertyAction({ images: [], property: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toContain("ECONNREFUSED");
      expect(result.message).not.toContain("10.0.0.5");
    }
  });
});

describe("updateQuoteAnalysisAction / updateQuoteCustomerAction / updateQuoteStatusAction", () => {
  it("updateQuoteAnalysisAction returns ok:false with a not-found message rather than throwing", async () => {
    mocks.updateQuoteAnalysis.mockRejectedValue(new Error('Quote "quote_x" not found.'));
    const result = await updateQuoteAnalysisAction("quote_x", {} as never);
    expect(result).toEqual({ ok: false, message: 'Quote "quote_x" not found.' });
  });

  it("updateQuoteCustomerAction returns ok:true with the updated quote", async () => {
    mocks.updateQuoteCustomer.mockResolvedValue({ id: "quote_1", customer: { name: "New Name" } });
    const result = await updateQuoteCustomerAction("quote_1", {} as never);
    expect(result).toEqual({ ok: true, data: { id: "quote_1", customer: { name: "New Name" } } });
  });

  it("updateQuoteStatusAction returns ok:false with the transition-graph message rather than throwing", async () => {
    mocks.updateQuoteStatus.mockRejectedValue(new Error('Cannot move a quote from "accepted" to "new".'));
    const result = await updateQuoteStatusAction("quote_1", "new");
    expect(result).toEqual({ ok: false, message: 'Cannot move a quote from "accepted" to "new".' });
  });
});

describe("recalculateQuoteEstimateAction", () => {
  it("returns ok:true with both the quote and its pricing configuration", async () => {
    mocks.recalculateQuoteEstimate.mockResolvedValue({ id: "quote_1", pricingConfigId: "config_1" });
    mocks.getConfigurationById.mockResolvedValue({ id: "config_1" });
    const result = await recalculateQuoteEstimateAction("quote_1");
    expect(result).toEqual({ ok: true, data: { quote: { id: "quote_1", pricingConfigId: "config_1" }, pricingConfiguration: { id: "config_1" } } });
  });

  it("returns ok:false rather than throwing on failure", async () => {
    mocks.recalculateQuoteEstimate.mockRejectedValue(new Error('Quote "quote_1" not found.'));
    const result = await recalculateQuoteEstimateAction("quote_1");
    expect(result).toEqual({ ok: false, message: 'Quote "quote_1" not found.' });
  });
});

describe("share link actions", () => {
  it("getQuoteShareLinkStatusAction returns ok:true with the status", async () => {
    mocks.getShareLinkStatus.mockResolvedValue({ active: false });
    const result = await getQuoteShareLinkStatusAction("quote_1");
    expect(result).toEqual({ ok: true, data: { active: false } });
  });

  it("generateQuoteShareLinkAction returns ok:true with a built share URL", async () => {
    mocks.generateShareLink.mockResolvedValue({ createdAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-02-01T00:00:00.000Z", token: "raw-token" });
    const result = await generateQuoteShareLinkAction("quote_1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.url).toBe("https://app.tallyvis.com/quote/raw-token");
  });

  it("revokeQuoteShareLinkAction returns ok:false rather than throwing on failure", async () => {
    mocks.revokeShareLink.mockRejectedValue(new Error('Quote "quote_1" not found.'));
    const result = await revokeQuoteShareLinkAction("quote_1");
    expect(result).toEqual({ ok: false, message: 'Quote "quote_1" not found.' });
  });
});

describe("recordJobOutcomeAction", () => {
  it("returns ok:true with the saved outcome", async () => {
    mocks.recordJobOutcome.mockResolvedValue({ id: "outcome_1" });
    const result = await recordJobOutcomeAction("quote_1", {} as never);
    expect(result).toEqual({ ok: true, data: { id: "outcome_1" } });
  });
});

describe("sendQuoteEmailAction", () => {
  it("returns ok:true with the email result", async () => {
    mocks.sendQuoteEmail.mockResolvedValue({ sentAt: "2026-01-01T00:00:00.000Z" });
    const result = await sendQuoteEmailAction("quote_1");
    expect(result).toEqual({ ok: true, data: { sentAt: "2026-01-01T00:00:00.000Z" } });
  });

  it("returns ok:false with the categorized notification failure message — never the raw provider text", async () => {
    mocks.sendQuoteEmail.mockRejectedValue(new FakeNotificationError("raw Resend detail", "provider-error"));
    const result = await sendQuoteEmailAction("quote_1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).not.toContain("raw Resend detail");
  });

  it("returns a generic safe message — never throws — for a genuinely unexpected error", async () => {
    mocks.sendQuoteEmail.mockRejectedValue(new Error("RESEND_API_KEY invalid: sk_live_abc123"));
    const result = await sendQuoteEmailAction("quote_1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).not.toContain("sk_live_abc123");
  });
});
