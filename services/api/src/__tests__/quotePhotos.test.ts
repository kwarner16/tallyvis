import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { useTestDb } from "./testHarness";
import { signUp } from "../services/auth";
import { createQuote, createQuotePublic } from "../services/quotes";
import { getQuotePhoto } from "../services/quotePhotos";
import { getDefaultPublicBusiness } from "../services/business";

/**
 * Production hardening (see docs/decisions/0038-quote-photo-storage.md) —
 * exercises the real upload-then-authorized-read round trip with an
 * in-memory fake standing in for `@vercel/blob`'s `put`/`get`/`del`, the
 * same "mock the provider SDK, not our own abstraction" approach the rest
 * of this package uses for Stripe/Twilio/Resend. This is the ONE file in
 * the suite that sets `BLOB_READ_WRITE_TOKEN` — every other test file
 * (e.g. quotes.test.ts's own photo tests) deliberately runs WITHOUT it to
 * cover the "not configured" degradation path, so this is restored in
 * `afterAll` and never left set for a later file in the same process.
 */
const fakeBlobStore = new Map<string, { data: Buffer; contentType: string }>();

vi.mock("@vercel/blob", () => ({
  put: vi.fn(async (pathname: string, body: Buffer, options: { contentType?: string }) => {
    fakeBlobStore.set(pathname, { data: Buffer.from(body), contentType: options.contentType ?? "application/octet-stream" });
    return { pathname };
  }),
  get: vi.fn(async (pathname: string) => {
    const entry = fakeBlobStore.get(pathname);
    if (!entry) return null;
    return {
      statusCode: 200,
      stream: new Response(new Uint8Array(entry.data)).body,
      blob: { contentType: entry.contentType },
    };
  }),
  del: vi.fn(async (pathnames: string[] | string) => {
    for (const p of Array.isArray(pathnames) ? pathnames : [pathnames]) fakeBlobStore.delete(p);
  }),
}));

const ORIGINAL_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

beforeAll(() => {
  process.env.BLOB_READ_WRITE_TOKEN = "test-token";
});

afterAll(() => {
  process.env.BLOB_READ_WRITE_TOKEN = ORIGINAL_TOKEN;
  fakeBlobStore.clear();
});

const getDb = useTestDb();

const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const sampleInput = (photos: { id: string; dataUrl: string }[] = []) => ({
  customer: { name: "Jordan Rivera", email: "jordan@example.com", phone: "(555) 000-1111" },
  property: { propertyType: "single-family" as const, stories: 2, address: "1 Test St" },
  servicePreferences: {
    interiorCleaning: false,
    screens: true,
    tracks: false,
    hardWaterTreatment: "unsure" as const,
  },
  notes: "",
  photos,
  analysis: {
    characteristics: {
      vertical: "window-cleaning" as const,
      windowCount: 10,
      windowType: "double-hung" as const,
      paneCount: 0,
      stories: 2,
      screens: 4,
      tracks: 0,
      accessibility: "moderate" as const,
      condition: "good" as const,
      hardWaterStaining: false,
      estimatedLaborHours: 1.5,
      interiorCleaning: false,
    },
    metadata: { confidence: "high" as const },
  },
});

async function setUp(businessName: string) {
  const db = getDb();
  const { session } = await signUp(db, {
    businessName,
    ownerEmail: `${businessName.toLowerCase().replace(/\s+/g, "-")}@example.com`,
    password: "correct-horse-battery",
  });
  return { db, session };
}

describe("uploadQuotePhotos — real upload/persist round trip", () => {
  it("uploads a submitted photo and persists an opaque storageKey (never the original data) on the quote", async () => {
    const { db, session } = await setUp("Sparkle Windows");
    const quote = await createQuote(db, session, sampleInput([{ id: "p0", dataUrl: TINY_PNG_DATA_URL }]));

    expect(quote.photos).toHaveLength(1);
    expect(quote.photos[0]!.id).toBe("p0");
    expect(quote.photos[0]!.storageKey).toMatch(new RegExp(`^quote-photos/${session.businessId}/`));
    expect(quote.photos[0]!.storageKey).not.toContain("base64");
  });

  it("skips an individual malformed photo without failing the whole quote", async () => {
    const { db, session } = await setUp("Sparkle Windows");
    const quote = await createQuote(
      db,
      session,
      sampleInput([
        { id: "good", dataUrl: TINY_PNG_DATA_URL },
        { id: "bad", dataUrl: "not-a-data-url" },
      ]),
    );

    expect(quote.photos).toHaveLength(1);
    expect(quote.photos[0]!.id).toBe("good");
  });
});

describe("getQuotePhoto — authorization and tenant isolation", () => {
  it("the owning business can retrieve the exact bytes it uploaded", async () => {
    const { db, session } = await setUp("Sparkle Windows");
    const quote = await createQuote(db, session, sampleInput([{ id: "p0", dataUrl: TINY_PNG_DATA_URL }]));

    const photo = await getQuotePhoto(db, session, quote.id, "p0");
    expect(photo).not.toBeNull();
    expect(photo!.contentType).toBe("image/png");
    expect(photo!.data.length).toBeGreaterThan(0);
  });

  it("a different business cannot retrieve another business's quote photo, even knowing the exact quote and photo id", async () => {
    const { session: sessionA } = await setUp("Sparkle Windows");
    const dbA = getDb();
    const quote = await createQuote(dbA, sessionA, sampleInput([{ id: "p0", dataUrl: TINY_PNG_DATA_URL }]));

    const { session: sessionB } = await setUp("Shiny Panes Co");
    const photo = await getQuotePhoto(getDb(), sessionB, quote.id, "p0");

    expect(photo).toBeNull();
  });

  it("returns null for a nonexistent quote id", async () => {
    const { db, session } = await setUp("Sparkle Windows");
    expect(await getQuotePhoto(db, session, "quote_does-not-exist", "p0")).toBeNull();
  });

  it("returns null for a nonexistent photo id on a real, owned quote", async () => {
    const { db, session } = await setUp("Sparkle Windows");
    const quote = await createQuote(db, session, sampleInput([{ id: "p0", dataUrl: TINY_PNG_DATA_URL }]));
    expect(await getQuotePhoto(db, session, quote.id, "not-a-real-photo-id")).toBeNull();
  });

  it("the public estimator path (createQuotePublic) persists photos the same way, retrievable by the embedding business", async () => {
    const { db } = await setUp("Public Path Co");
    const business = (await getDefaultPublicBusiness(db))!;

    const quote = await createQuotePublic(db, business.id, sampleInput([{ id: "p0", dataUrl: TINY_PNG_DATA_URL }]));
    expect(quote.photos).toHaveLength(1);
  });
});
