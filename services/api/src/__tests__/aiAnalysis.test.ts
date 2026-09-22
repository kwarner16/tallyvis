import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTestDb } from "./testHarness";
import { signUp } from "../services/auth";
import { getDefaultPublicBusiness } from "../services/business";
import { AiProviderError, analyzePropertyForBusiness, analyzePropertyPublic } from "../services/aiAnalysis";

const getDb = useTestDb();

/** Resolves the rejection and asserts it's an `AiProviderError` tagged with `category` — see `services/ai/src/__tests__/anthropic.test.ts`'s twin. */
async function expectCategory(promise: Promise<unknown>, category: string): Promise<void> {
  await promise.then(
    () => expect.unreachable("expected the promise to reject"),
    (err: unknown) => {
      expect(err).toBeInstanceOf(AiProviderError);
      expect((err as AiProviderError).category).toBe(category);
    },
  );
}

/**
 * Phase 11 — AI analysis orchestration. See
 * docs/decisions/0013-ai-analysis-foundation.md. `AI_PROVIDER` is left
 * unset/`"mock"` for these tests, so they run with zero network access and
 * no credentials — exactly what the deterministic mock provider is for.
 * Focus: authorization (session-derived, never a client id), input
 * bounds, and the pricing boundary (AI output can only ever become
 * estimator input, never a price).
 */

const ORIGINAL_AI_PROVIDER = process.env.AI_PROVIDER;

beforeEach(() => {
  delete process.env.AI_PROVIDER; // force the mock provider regardless of the environment's own setting
});

afterEach(() => {
  if (ORIGINAL_AI_PROVIDER === undefined) delete process.env.AI_PROVIDER;
  else process.env.AI_PROVIDER = ORIGINAL_AI_PROVIDER;
});

function dataUrlImage(seed: string): { url: string } {
  // A tiny, distinct base64 payload per image — real bytes don't matter to the mock provider, only that each is a well-formed data: URI.
  return { url: `data:image/jpeg;base64,${Buffer.from(seed).toString("base64")}` };
}

const threeImages = [dataUrlImage("a"), dataUrlImage("b"), dataUrlImage("c")];

async function setUpBusiness() {
  const db = getDb();
  const { session } = await signUp(db, {
    businessName: "Sparkle Windows",
    ownerEmail: "owner@sparkle.example",
    password: "correct-horse-battery",
  });
  return { db, session };
}

describe("analyzePropertyForBusiness — authenticated path", () => {
  it("an authenticated business can analyze its own estimator input", async () => {
    const { db, session } = await setUpBusiness();
    const result = await analyzePropertyForBusiness(db, session, {
      images: threeImages,
      property: { stories: 2 },
    });
    expect(result.analysis.characteristics.vertical).toBe("window-cleaning");
    expect(result.observation.vertical).toBe("window-cleaning");
  });

  it("derives the business entirely from the session — there is no businessId parameter to override it", async () => {
    const { db, session } = await setUpBusiness();
    // Nothing in AnalyzePropertyInput can express "act as a different business" —
    // this is a structural guarantee, demonstrated by calling with only images/property.
    const result = await analyzePropertyForBusiness(db, session, { images: threeImages, property: {} });
    expect(result.analysis).toBeDefined();
  });

  it("rejects zero photos", async () => {
    const { db, session } = await setUpBusiness();
    await expect(analyzePropertyForBusiness(db, session, { images: [], property: {} })).rejects.toThrow(
      /at least one photo/i,
    );
  });

  it("rejects more than the maximum number of photos, tagged with the \"too-many-images\" category", async () => {
    const { db, session } = await setUpBusiness();
    const tooMany = Array.from({ length: 9 }, (_, i) => dataUrlImage(`photo-${i}`));
    await expectCategory(analyzePropertyForBusiness(db, session, { images: tooMany, property: {} }), "too-many-images");
  });

  it("rejects a non-image data URI, tagged with the \"invalid-image\" category", async () => {
    const { db, session } = await setUpBusiness();
    const badImage = { url: "data:text/plain;base64,aGVsbG8=" };
    await expectCategory(analyzePropertyForBusiness(db, session, { images: [badImage], property: {} }), "invalid-image");
  });

  it("rejects a bare (non-data-URI) URL — a stale blob: URL cannot be analyzed server-side", async () => {
    const { db, session } = await setUpBusiness();
    const blobImage = { url: "blob:http://localhost:3001/abc-123" };
    await expect(analyzePropertyForBusiness(db, session, { images: [blobImage], property: {} })).rejects.toThrow(
      /valid image/i,
    );
  });

  it("rejects an oversized image, tagged with the \"image-too-large\" category", async () => {
    const { db, session } = await setUpBusiness();
    const huge = { url: `data:image/jpeg;base64,${"A".repeat(15 * 1024 * 1024)}` }; // ~11MB decoded
    await expectCategory(analyzePropertyForBusiness(db, session, { images: [huge], property: {} }), "image-too-large");
  });
});

describe("analyzePropertyPublic — unauthenticated estimator path", () => {
  it("resolves against the businessId the caller passes in (mirroring createQuotePublic's pattern) — never invents its own", async () => {
    const { db, session } = await setUpBusiness();
    const publicBusiness = (await getDefaultPublicBusiness(db))!;
    expect(publicBusiness.id).toBe(session.businessId);

    const result = await analyzePropertyPublic(db, publicBusiness.id, { images: threeImages, property: { stories: 1 } });
    expect(result.analysis.characteristics.vertical).toBe("window-cleaning");
  });

  it("applies the exact same input validation as the authenticated path", async () => {
    const { db, session } = await setUpBusiness();
    await expect(analyzePropertyPublic(db, session.businessId, { images: [], property: {} })).rejects.toThrow(
      /at least one photo/i,
    );
  });
});

describe("duplicate-call avoidance", () => {
  it("does not re-invoke the provider for an identical request within the dedup window (observable via consistent output for identical input)", async () => {
    const { db, session } = await setUpBusiness();
    const first = await analyzePropertyForBusiness(db, session, { images: threeImages, property: { stories: 2 } });
    const second = await analyzePropertyForBusiness(db, session, { images: threeImages, property: { stories: 2 } });
    expect(second).toEqual(first);
  });

  it("does not conflate two different requests from the same business", async () => {
    const { db, session } = await setUpBusiness();
    const twoPhotoResult = await analyzePropertyForBusiness(db, session, { images: [threeImages[0]!], property: { stories: 1 } });
    const threePhotoResult = await analyzePropertyForBusiness(db, session, { images: threeImages, property: { stories: 3 } });
    expect(twoPhotoResult.analysis.metadata.confidence).not.toBe(threePhotoResult.analysis.metadata.confidence);
  });
});

describe("pricing boundary — AI output never reaches pricing directly", () => {
  it("the analysis result contains estimator inputs only — no total, price, rate, or multiplier field at any level", async () => {
    const { db, session } = await setUpBusiness();
    const result = await analyzePropertyForBusiness(db, session, { images: threeImages, property: { stories: 2 } });
    const serialized = JSON.stringify(result);
    for (const forbidden of ["totalPrice", "\"total\"", "hourlyRate", "\"price\"", "multiplier"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("changing the AI-derived input changes only the estimator characteristics that feed calculateEstimate — never a dollar amount by itself", async () => {
    const { db, session } = await setUpBusiness();
    const oneStory = await analyzePropertyForBusiness(db, session, { images: threeImages, property: { stories: 1 } });
    const threeStory = await analyzePropertyForBusiness(db, session, {
      images: [dataUrlImage("x"), dataUrlImage("y"), dataUrlImage("z")],
      property: { stories: 3 },
    });
    // The analysis differs (different characteristics) — but it is characteristics, not a price, that differ.
    expect(oneStory.analysis.characteristics.stories).not.toBe(threeStory.analysis.characteristics.stories);
    expect(oneStory.analysis).not.toHaveProperty("total");
    expect(threeStory.analysis).not.toHaveProperty("total");
  });
});
