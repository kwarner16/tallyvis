import { createBlobPhotoStorage } from "./providers/blob";
import { PhotoStorageError, type PhotoStorage } from "./types";

export { PhotoStorageError, type PhotoStorage, type StoredPhoto, type PhotoStorageErrorCategory } from "./types";

let cached: PhotoStorage | null = null;

/**
 * The one place `BLOB_READ_WRITE_TOKEN` is implicitly read (by the
 * `@vercel/blob` SDK itself) — every caller in this package only ever
 * calls `getPhotoStorage()`, never imports `@vercel/blob` directly, the
 * same pattern `notifications/index.ts`'s `resolveEmailProvider` already
 * established. Cached after the first successful resolution, matching
 * `services/ai`'s own provider-caching comment: cheap, and avoids
 * re-reading `process.env` on every photo.
 */
export function getPhotoStorage(): PhotoStorage {
  if (cached) return cached;
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new PhotoStorageError(
      "Photo storage is not configured for this environment (BLOB_READ_WRITE_TOKEN missing).",
      "not-configured",
    );
  }
  cached = createBlobPhotoStorage();
  return cached;
}
