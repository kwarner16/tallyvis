/**
 * Production hardening (see docs/decisions/0038-quote-photo-storage.md) —
 * a small server-side object-storage abstraction for customer quote
 * photos, deliberately mirroring `notifications/types.ts`'s
 * `EmailProvider`/`NotificationError` shape: a narrow interface, a
 * categorized error, and exactly one real implementation selected in
 * `storage/index.ts`. There is no "dev" no-op provider the way
 * email/SMS have one — unlike a dev-console log standing in for a real
 * send, there is no meaningful way to fake durable byte storage, so
 * callers inject a test double directly instead (see
 * `__tests__/quotePhotos.test.ts`).
 */

export interface StoredPhoto {
  data: Buffer;
  contentType: string;
}

export interface PhotoStorage {
  /** For error messages and logging — never a secret. */
  readonly name: string;
  upload(pathname: string, data: Buffer, contentType: string): Promise<void>;
  download(pathname: string): Promise<StoredPhoto | null>;
  delete(pathnames: string[]): Promise<void>;
}

export type PhotoStorageErrorCategory = "not-configured" | "invalid-image" | "provider-error";

/** Thrown instead of a bare `Error` so a caller can tell "not configured" from "the image itself was bad" apart, exactly like `NotificationError`/`AiProviderError`. `message` is always safe to display or log as-is — never includes image bytes. */
export class PhotoStorageError extends Error {
  readonly category: PhotoStorageErrorCategory;

  constructor(message: string, category: PhotoStorageErrorCategory) {
    super(message);
    this.name = "PhotoStorageError";
    this.category = category;
  }
}
