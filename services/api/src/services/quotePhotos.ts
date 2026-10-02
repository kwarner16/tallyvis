import type { Quote, QuotePhoto } from "@tallyvis/types";
import type { AuthSession } from "../auth/session";
import type { Queryable } from "../db/pg/client";
import { makeId } from "../db/ids";
import { getQuoteById } from "../repositories/quotes";
import { getPhotoStorage, PhotoStorageError, type StoredPhoto } from "../storage";

/**
 * Production hardening (see docs/decisions/0038-quote-photo-storage.md) —
 * the submission-time shape of a customer's photo, as it travels from the
 * browser to `persistPricedQuote`. `dataUrl` is a base64 `data:` URI
 * produced client-side (compressed, then read via `FileReader` — see
 * apps/app's `imageCompression.ts`/`imageEncoding.ts`), NEVER a browser
 * `blob:` object URL — a `blob:` URL is only valid inside the tab that
 * created it and is meaningless to this server process, which is exactly
 * why no customer photo ever reached a business's dashboard before this
 * type existed (one was stored as literally the string `"blob:..."`).
 */
export interface PendingQuotePhoto {
  id: string;
  dataUrl: string;
}

/**
 * Generous but bounded, matching `services/quotes.ts`'s existing
 * `MAX_QUOTE_PHOTOS`/`MAX_PHOTO_URL_LENGTH` sanity ceilings — this
 * endpoint is reachable with no session (the public estimator), so it
 * must reject abuse server-side regardless of what the browser's own
 * upload UI already enforces.
 */
const MAX_PHOTOS = 12;
const MAX_DATA_URL_LENGTH = 8_000_000;
const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function validateIncomingPhotos(photos: unknown): PendingQuotePhoto[] {
  if (!Array.isArray(photos)) {
    throw new Error("Photos must be a list.");
  }
  if (photos.length > MAX_PHOTOS) {
    throw new Error(`Too many photos — at most ${MAX_PHOTOS} are allowed.`);
  }
  for (const photo of photos) {
    if (
      typeof photo !== "object" ||
      photo === null ||
      typeof (photo as { id?: unknown }).id !== "string" ||
      typeof (photo as { dataUrl?: unknown }).dataUrl !== "string"
    ) {
      throw new Error("Each photo must have an id and image data.");
    }
    if ((photo as { dataUrl: string }).dataUrl.length > MAX_DATA_URL_LENGTH) {
      throw new Error("One of the uploaded photos is too large.");
    }
  }
  return photos as PendingQuotePhoto[];
}

function decodeDataUrl(dataUrl: string): { buffer: Buffer; contentType: string } {
  const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(dataUrl);
  if (!match) {
    throw new PhotoStorageError("Photo data was not a valid image.", "invalid-image");
  }
  const [, contentType, base64] = match as unknown as [string, string, string];
  if (!(contentType in ALLOWED_CONTENT_TYPES)) {
    throw new PhotoStorageError(`Unsupported photo type "${contentType}".`, "invalid-image");
  }
  return { buffer: Buffer.from(base64, "base64"), contentType };
}

/**
 * Uploads every pending photo to private object storage and returns the
 * reference to persist on the quote row. A single photo that fails to
 * decode/store is skipped rather than failing the whole submission — the
 * customer's price and request must still reach the business even if one
 * photo can't be stored (same "never block the primary flow" principle
 * `sendNewQuoteSmsAlert`/`sendEmail` already follow) — and the same is
 * true if photo storage isn't configured in this environment at all
 * (e.g. a local dev/test run with no `BLOB_READ_WRITE_TOKEN`): the quote
 * is still created, just with no photos. Never logs image data, only a
 * message/category.
 */
export async function uploadQuotePhotos(businessId: string, photos: PendingQuotePhoto[]): Promise<QuotePhoto[]> {
  if (photos.length === 0) return [];

  let storage;
  try {
    storage = getPhotoStorage();
  } catch (err) {
    console.error(
      "[quotePhotos] photo storage unavailable, saving this quote without photos:",
      err instanceof Error ? err.message : "unknown error",
    );
    return [];
  }

  const results = await Promise.all(
    photos.map(async (photo): Promise<QuotePhoto | null> => {
      try {
        const { buffer, contentType } = decodeDataUrl(photo.dataUrl);
        const extension = ALLOWED_CONTENT_TYPES[contentType];
        const storageKey = `quote-photos/${businessId}/${makeId("photo")}.${extension}`;
        await storage.upload(storageKey, buffer, contentType);
        return { id: photo.id, storageKey };
      } catch (err) {
        console.error(
          "[quotePhotos] failed to store a submitted photo, skipping it:",
          err instanceof Error ? err.message : "unknown error",
        );
        return null;
      }
    }),
  );

  return results.filter((photo): photo is QuotePhoto => photo !== null);
}

/**
 * The one read path for a quote's photo bytes — scoped by
 * `session.businessId` through `getQuoteById`'s own `WHERE business_id =
 * $2` (never just checked after the fact), so a wrong/guessed quote or
 * photo id for a DIFFERENT business's quote resolves to `null` here,
 * never that business's photo. Callers (the dashboard's authenticated
 * photo route) must treat `null` as a 404, not distinguish "quote not
 * found" from "not your quote" — see that route's own comment for why
 * that distinction must never be observable to the caller.
 */
export async function getQuotePhoto(
  db: Queryable,
  session: AuthSession,
  quoteId: string,
  photoId: string,
): Promise<StoredPhoto | null> {
  const quote: Quote | undefined = await getQuoteById(db, session.businessId, quoteId);
  if (!quote) return null;
  const photo = quote.photos.find((p) => p.id === photoId);
  if (!photo) return null;
  const storage = getPhotoStorage();
  return storage.download(photo.storageKey);
}
