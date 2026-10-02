import { put, get, del } from "@vercel/blob";
import type { PhotoStorage, StoredPhoto } from "../types";

/**
 * Vercel Blob, private access (see docs/decisions/0038-quote-photo-storage.md).
 * `access: "private"` means a pathname is never independently fetchable —
 * reading one back always requires this same `BLOB_READ_WRITE_TOKEN`,
 * which only ever lives server-side (`services/api`, never bundled to a
 * browser). `addRandomSuffix: false` because every pathname this package
 * generates (see `services/quotePhotos.ts`) already embeds a fresh random
 * id — a second random suffix would just make pathnames harder to reason
 * about for no benefit.
 */
export function createBlobPhotoStorage(): PhotoStorage {
  return {
    name: "vercel-blob",
    async upload(pathname, data, contentType) {
      await put(pathname, data, { access: "private", addRandomSuffix: false, contentType });
    },
    async download(pathname): Promise<StoredPhoto | null> {
      // No `ifNoneMatch` is ever passed, so a 304 (the only case with a
      // `null` stream/contentType) can never actually happen here — this
      // check only satisfies the SDK's discriminated-union return type.
      const result = await get(pathname, { access: "private" });
      if (!result || result.statusCode !== 200) return null;
      const buffer = Buffer.from(await new Response(result.stream).arrayBuffer());
      return { data: buffer, contentType: result.blob.contentType };
    },
    async delete(pathnames) {
      if (pathnames.length === 0) return;
      await del(pathnames);
    },
  };
}
