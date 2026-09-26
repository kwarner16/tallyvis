import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Regression coverage for the production bug this exists to catch: Next.js
 * strips a thrown error's real message in a production build before it
 * reaches the client (confirmed against this repo's installed Next.js
 * version — see actionResult.ts's own comment), which surfaced as a
 * minified React error #441 on the deployed public estimator instead of
 * the intended "This estimator isn't set up correctly..." / AI-failure-
 * category message. Every exported action in publicActions.ts must return
 * a `ActionResult` — never throw — so this file exists specifically
 * to catch a regression back to `throw`.
 *
 * `@tallyvis/api` is mocked entirely: this file tests publicActions.ts's
 * own error-handling/wrapping logic, not business resolution or database
 * behavior (already covered by services/api's own test suite against real
 * Postgres).
 */

const mocks = vi.hoisted(() => ({
  resolveEmbedBusiness: vi.fn(),
  resolvePublicBusinessSummary: vi.fn(),
  getActiveConfigurationForBusiness: vi.fn(),
  analyzePropertyPublic: vi.fn(),
  describeEvidenceGaps: vi.fn((): string[] => []),
  createQuotePublic: vi.fn(),
  updateQuotePublic: vi.fn(),
  getQuoteByShareToken: vi.fn(),
  acceptQuoteByToken: vi.fn(),
  declineQuoteByToken: vi.fn(),
  requestQuoteChangesByToken: vi.fn(),
}));

class FakeAiProviderError extends Error {
  category: string;
  constructor(message: string, category: string) {
    super(message);
    this.category = category;
  }
}

vi.mock("@tallyvis/api", () => ({
  getDb: vi.fn(() => ({})),
  AiProviderError: FakeAiProviderError,
  resolveEmbedBusiness: mocks.resolveEmbedBusiness,
  resolvePublicBusinessSummary: mocks.resolvePublicBusinessSummary,
  getActiveConfigurationForBusiness: mocks.getActiveConfigurationForBusiness,
  analyzePropertyPublic: mocks.analyzePropertyPublic,
  describeEvidenceGaps: mocks.describeEvidenceGaps,
  createQuotePublic: mocks.createQuotePublic,
  updateQuotePublic: mocks.updateQuotePublic,
  getQuoteByShareToken: mocks.getQuoteByShareToken,
  acceptQuoteByToken: mocks.acceptQuoteByToken,
  declineQuoteByToken: mocks.declineQuoteByToken,
  requestQuoteChangesByToken: mocks.requestQuoteChangesByToken,
}));

const {
  getPublicBusinessAction,
  getPublicActiveConfigurationAction,
  verifyEmbedIdAction,
  analyzePublicPropertyAction,
  createPublicQuoteAction,
  updatePublicQuoteAction,
  getPublicQuoteByTokenAction,
  acceptPublicQuoteAction,
  declinePublicQuoteAction,
  requestPublicQuoteChangesAction,
} = await import("../publicActions");
const { ESTIMATOR_NOT_CONFIGURED_MESSAGE, DEMO_ESTIMATE_NOT_SAVED_MESSAGE } = await import("../publicBusinessErrors");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getPublicBusinessAction", () => {
  it("returns ok:true with the resolved summary", async () => {
    mocks.resolvePublicBusinessSummary.mockResolvedValue({ name: "Acme", brandColor: "#0057B8" });
    const result = await getPublicBusinessAction("embed-123");
    expect(result).toEqual({ ok: true, data: { name: "Acme", brandColor: "#0057B8" } });
  });

  it("returns ok:false with a safe message when the embed id doesn't resolve — never throws", async () => {
    mocks.resolvePublicBusinessSummary.mockResolvedValue(undefined);
    const result = await getPublicBusinessAction("bad-embed-id");
    expect(result).toEqual({ ok: false, message: ESTIMATOR_NOT_CONFIGURED_MESSAGE });
  });

  it("returns ok:false instead of throwing when the underlying lookup throws unexpectedly", async () => {
    mocks.resolvePublicBusinessSummary.mockRejectedValue(new Error("connection terminated unexpectedly"));
    const result = await getPublicBusinessAction("embed-123");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Never the raw internal error message (could echo connection/DB internals).
      expect(result.message).not.toContain("connection terminated");
    }
  });

  /**
   * 2026-09 "direct estimator" incident (docs/decisions/0027): the direct,
   * un-embedded `/estimate` demo (no `embedId`) must NEVER resolve or
   * expose a real business — it now returns a clearly-labeled demo
   * summary without touching the database at all.
   */
  it("returns a clearly-labeled demo summary, without touching the database, when no embed id is given", async () => {
    const result = await getPublicBusinessAction();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.name).toMatch(/demo/i);
    expect(mocks.resolvePublicBusinessSummary).not.toHaveBeenCalled();
  });
});

describe("getPublicActiveConfigurationAction", () => {
  it("returns ok:true with the configuration", async () => {
    mocks.resolveEmbedBusiness.mockResolvedValue({ id: "biz_1" });
    mocks.getActiveConfigurationForBusiness.mockResolvedValue({ id: "config_1" });
    const result = await getPublicActiveConfigurationAction("embed-123");
    expect(result).toEqual({ ok: true, data: { id: "config_1" } });
  });

  it("returns ok:false when the business can't be resolved", async () => {
    mocks.resolveEmbedBusiness.mockResolvedValue(undefined);
    const result = await getPublicActiveConfigurationAction("bad-id");
    expect(result).toEqual({ ok: false, message: ESTIMATOR_NOT_CONFIGURED_MESSAGE });
  });

  it("returns the standalone demo pricing configuration, without touching the database, when no embed id is given (2026-09 incident, docs/decisions/0027)", async () => {
    const result = await getPublicActiveConfigurationAction();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.businessId).toBe("demo-window-cleaning-co");
    expect(mocks.resolveEmbedBusiness).not.toHaveBeenCalled();
    expect(mocks.getActiveConfigurationForBusiness).not.toHaveBeenCalled();
  });
});

describe("verifyEmbedIdAction (2026-09 \"lost tenant identity\" incident, docs/decisions/0026: confirmed-invalid and unexpected-error must be DISTINGUISHABLE, not collapsed into the same value)", () => {
  it("resolves to null (not false, not a thrown error) when the lookup itself throws — an unexpected error is NOT the same as a confirmed-invalid embed id", async () => {
    mocks.resolveEmbedBusiness.mockRejectedValue(new Error("db unavailable"));
    await expect(verifyEmbedIdAction("any-id")).resolves.toBeNull();
  });

  it("resolves to false when the lookup completes and confirms no business has this embed id", async () => {
    mocks.resolveEmbedBusiness.mockResolvedValue(undefined);
    await expect(verifyEmbedIdAction("any-id")).resolves.toBe(false);
  });

  it("resolves to true when the lookup completes and finds a business", async () => {
    mocks.resolveEmbedBusiness.mockResolvedValue({ id: "biz_1" });
    await expect(verifyEmbedIdAction("any-id")).resolves.toBe(true);
  });
});

describe("analyzePublicPropertyAction", () => {
  it("returns ok:true with the analysis result on success (embedded)", async () => {
    mocks.resolveEmbedBusiness.mockResolvedValue({ id: "biz_1" });
    mocks.analyzePropertyPublic.mockResolvedValue({ analysis: { characteristics: {}, metadata: {} }, observation: {} });
    const result = await analyzePublicPropertyAction({ images: [], property: {} }, "embed-123");
    expect(result.ok).toBe(true);
  });

  it("attaches evidenceMessages computed server-side via describeEvidenceGaps (Vision V1.1)", async () => {
    mocks.resolveEmbedBusiness.mockResolvedValue({ id: "biz_1" });
    const observation = { evidence: { coverage: "partial", overallEvidence: "insufficient", issues: [] } };
    mocks.analyzePropertyPublic.mockResolvedValue({ analysis: { characteristics: {}, metadata: {} }, observation });
    mocks.describeEvidenceGaps.mockReturnValue(["A closer photo would help."]);
    const result = await analyzePublicPropertyAction({ images: [], property: {} }, "embed-123");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(mocks.describeEvidenceGaps).toHaveBeenCalledWith(observation);
    expect(result.data.evidenceMessages).toEqual(["A closer photo would help."]);
  });

  it("returns ok:false with the business-not-configured message when the business can't be resolved — never throws", async () => {
    mocks.resolveEmbedBusiness.mockResolvedValue(undefined);
    const result = await analyzePublicPropertyAction({ images: [], property: {} }, "bad-embed-id");
    expect(result).toEqual({ ok: false, message: ESTIMATOR_NOT_CONFIGURED_MESSAGE });
  });

  /**
   * 2026-09 "direct estimator" incident (docs/decisions/0027): analysis
   * is entirely business-agnostic (businessId only ever feeds a de-dup
   * cache key — see services/api's runAnalysisFor), so the direct,
   * un-embedded demo must succeed WITHOUT ever resolving a real business.
   */
  it("succeeds without resolving any business when there's no embed id (the direct estimator demo)", async () => {
    mocks.analyzePropertyPublic.mockResolvedValue({ analysis: { characteristics: {}, metadata: {} }, observation: {} });
    const result = await analyzePublicPropertyAction({ images: [], property: {} });
    expect(result.ok).toBe(true);
    expect(mocks.resolveEmbedBusiness).not.toHaveBeenCalled();
  });

  it("returns ok:false with the categorized AI failure message — never throws — for an AiProviderError", async () => {
    mocks.analyzePropertyPublic.mockRejectedValue(new FakeAiProviderError("raw provider detail", "rate-limit"));
    const result = await analyzePublicPropertyAction({ images: [], property: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe("The AI provider is busy right now — please try again in a moment.");
      // The category message, never the raw provider-supplied text.
      expect(result.message).not.toContain("raw provider detail");
    }
  });

  it("returns a generic safe message — never throws — for a genuinely unexpected error", async () => {
    mocks.analyzePropertyPublic.mockRejectedValue(new Error("ECONNREFUSED 10.0.0.5:5432"));
    const result = await analyzePublicPropertyAction({ images: [], property: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toContain("ECONNREFUSED");
      expect(result.message).not.toContain("10.0.0.5");
    }
  });
});

describe("createPublicQuoteAction", () => {
  it("returns ok:true with only the new quote's id (embedded)", async () => {
    mocks.resolveEmbedBusiness.mockResolvedValue({ id: "biz_1" });
    mocks.createQuotePublic.mockResolvedValue({ id: "quote_1", businessId: "biz_1", customerId: "cust_1" });
    const result = await createPublicQuoteAction({} as never, "embed-123");
    expect(result).toEqual({ ok: true, data: { id: "quote_1" } });
  });

  it("returns ok:false instead of throwing when business resolution fails", async () => {
    mocks.resolveEmbedBusiness.mockResolvedValue(undefined);
    const result = await createPublicQuoteAction({} as never, "bad-id");
    expect(result).toEqual({ ok: false, message: ESTIMATOR_NOT_CONFIGURED_MESSAGE });
  });

  /**
   * 2026-09 "direct estimator" incident (docs/decisions/0027) — the CORE
   * safety invariant this mission fixes: the direct, un-embedded
   * `/estimate` demo must NEVER persist a real quote for any business,
   * arbitrary or otherwise. Checked BEFORE any database access at all.
   */
  it("refuses to persist a quote, without ever resolving a business or touching the database, when no embed id is given", async () => {
    const result = await createPublicQuoteAction({} as never);
    expect(result).toEqual({ ok: false, message: DEMO_ESTIMATE_NOT_SAVED_MESSAGE });
    expect(mocks.resolveEmbedBusiness).not.toHaveBeenCalled();
    expect(mocks.createQuotePublic).not.toHaveBeenCalled();
  });
});

describe("updatePublicQuoteAction (2026-09 incident: re-analysis must write back to the SAME quote, not be silently discarded)", () => {
  it("returns ok:true with the same quote's id on a successful re-analysis update (embedded)", async () => {
    mocks.resolveEmbedBusiness.mockResolvedValue({ id: "biz_1" });
    mocks.updateQuotePublic.mockResolvedValue({ id: "quote_1", businessId: "biz_1", customerId: "cust_1" });
    const result = await updatePublicQuoteAction("quote_1", {} as never, "embed-123");
    expect(result).toEqual({ ok: true, data: { id: "quote_1" } });
    expect(mocks.updateQuotePublic).toHaveBeenCalledWith(expect.anything(), "biz_1", "quote_1", expect.anything());
  });

  it("returns ok:false instead of throwing when business resolution fails", async () => {
    mocks.resolveEmbedBusiness.mockResolvedValue(undefined);
    const result = await updatePublicQuoteAction("quote_1", {} as never, "bad-id");
    expect(result).toEqual({ ok: false, message: ESTIMATOR_NOT_CONFIGURED_MESSAGE });
  });

  it("returns a safe generic message (never a raw error) when the update itself fails unexpectedly", async () => {
    mocks.resolveEmbedBusiness.mockResolvedValue({ id: "biz_1" });
    mocks.updateQuotePublic.mockRejectedValue(new Error("db unavailable"));
    const result = await updatePublicQuoteAction("quote_1", {} as never, "embed-123");
    expect(result.ok).toBe(false);
  });

  it("refuses to update any quote, without ever touching the database, when no embed id is given", async () => {
    const result = await updatePublicQuoteAction("quote_1", {} as never);
    expect(result).toEqual({ ok: false, message: DEMO_ESTIMATE_NOT_SAVED_MESSAGE });
    expect(mocks.updateQuotePublic).not.toHaveBeenCalled();
  });
});

describe("getPublicQuoteByTokenAction", () => {
  it("resolves to null (not a thrown error) when the lookup throws unexpectedly", async () => {
    mocks.getQuoteByShareToken.mockRejectedValue(new Error("db unavailable"));
    await expect(getPublicQuoteByTokenAction("some-token")).resolves.toBeNull();
  });
});

describe("customer quote-response actions never throw", () => {
  it("acceptPublicQuoteAction returns ok:false with the service's own safe message on failure", async () => {
    mocks.acceptQuoteByToken.mockRejectedValue(new Error("This quote link is invalid or has expired."));
    const result = await acceptPublicQuoteAction("bad-token");
    expect(result).toEqual({ ok: false, message: "This quote link is invalid or has expired." });
  });

  it("declinePublicQuoteAction returns ok:true with the updated quote", async () => {
    mocks.declineQuoteByToken.mockResolvedValue({ id: "quote_1", status: "declined" });
    const result = await declinePublicQuoteAction("good-token");
    expect(result).toEqual({ ok: true, data: { id: "quote_1", status: "declined" } });
  });

  it("requestPublicQuoteChangesAction returns ok:false rather than throwing", async () => {
    mocks.requestQuoteChangesByToken.mockRejectedValue(new Error("Please describe what you'd like changed."));
    const result = await requestPublicQuoteChangesAction("good-token", "");
    expect(result).toEqual({ ok: false, message: "Please describe what you'd like changed." });
  });
});
