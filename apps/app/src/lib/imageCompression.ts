import { blobToDataUrl } from "./imageEncoding";

/**
 * Client-side photo preprocessing before an estimator photo ever reaches a
 * Server Action. Exists because Vercel Functions enforce a hard,
 * platform-level 4.5MB total request body limit (confirmed against
 * Vercel's current published docs — see next.config.ts's own comment) and
 * a base64 data URI (how a photo travels to the AI provider — see
 * publicActions.ts/quoteActions.ts) is ~4/3 the size of the original file.
 * A real, uncompressed modern phone photo (commonly 3-12MB) would already
 * approach or exceed that limit on its own — asking customers to manually
 * shrink their own photos before uploading was never a real option, so
 * this compresses every photo in the browser instead.
 *
 * Resize target (1568px long edge) is not an arbitrary guess: it's
 * Anthropic's own documented max long edge for the "Standard" resolution
 * tier (see https://platform.claude.com/docs/en/build-with-claude/vision,
 * "Resolution and token cost") — the model downscales anything larger to
 * (at best) that size before looking at it anyway, so sending more pixels
 * than that only inflates the request without adding anything the model
 * can actually use. Anthropic's own image-quality guidance explicitly
 * recommends lossy JPEG/WebP compression before sending for exactly this
 * reason ("Image compression" under "Image quality guidance" on the same
 * page).
 *
 * Request-budget accounting (see the mission's own Part 5): up to
 * `MAX_ANALYSIS_PHOTOS` (6) photos, each compressed toward
 * `COMPRESSION_TARGET_BYTES` (450KB raw) — worst case 6 * 450KB = 2.7MB
 * raw, * 4/3 for base64 = 3.6MB, comfortably under next.config.ts's
 * 4.2MB `bodySizeLimit`, itself comfortably under Vercel's hard 4.5MB
 * ceiling, leaving headroom for the property/customer JSON fields and
 * Next's own Server Action framing overhead.
 */

/** Anthropic's own documented max long edge for the "Standard" resolution tier — sending more only inflates the request, never adds fidelity the model actually uses. See this file's own top comment. */
export const COMPRESSION_MAX_LONG_EDGE = 1568;

/**
 * What each photo is compressed toward, in raw (pre-base64) bytes — see
 * this file's own top comment for the full request-budget accounting this
 * value is derived from, not guessed.
 */
export const COMPRESSION_TARGET_BYTES = 450 * 1024;

/**
 * The only real gate on the ORIGINAL, uncompressed file — compression
 * handles arbitrarily-sized real phone photos, so this only exists to
 * reject truly absurd input (a mis-selected video file, a multi-hundred-
 * megabyte scan) before ever asking the browser to decode it, not to
 * protect the request body (compression does that).
 */
export const MAX_SOURCE_FILE_BYTES = 20 * 1024 * 1024;

/** Quality steps tried in order until the encoded size fits `COMPRESSION_TARGET_BYTES`, or the last (lowest-quality) step is reached. Exported so the exact policy is visible/testable without re-deriving it. */
export const JPEG_QUALITY_STEPS: readonly number[] = [0.82, 0.68, 0.5, 0.35];

export class ImageCompressionError extends Error {}

/**
 * Scales `width`x`height` down (never up) so neither dimension exceeds
 * `maxLongEdge`, preserving aspect ratio. Pure and DOM-free — the part of
 * this module's policy that's actually worth unit testing directly,
 * rather than mocking `createImageBitmap`/canvas just to exercise this
 * same arithmetic indirectly.
 */
export function computeTargetDimensions(
  width: number,
  height: number,
  maxLongEdge: number,
): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxLongEdge || longEdge === 0) return { width, height };
  const scale = maxLongEdge / longEdge;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** A base64 encoding of `rawBytes` is always this size or the next multiple of 4 up from it (padding) — used only to reason about/report the request budget, never to gate anything itself (the real gate is the encoded size Next.js/Vercel actually see). */
export function estimateBase64Bytes(rawBytes: number): number {
  return Math.ceil(rawBytes / 3) * 4;
}

export interface CompressedImage {
  /** The compressed JPEG itself — callers that need a `blob:` preview URL (EstimatorContext, whose existing `blobUrlToDataUrl` re-reads it into a data URI later, unchanged) use this directly rather than round-tripping through `dataUrl` below. */
  blob: Blob;
  /** A `data:image/jpeg;base64,...` URI of the same bytes as `blob` — the exact shape callers that read a File directly with no blob: URL indirection (NewQuoteClient's dashboard AI panel) already expect. Nothing about that downstream contract changes; this only ever produces smaller inputs to it. */
  dataUrl: string;
  /** The compressed file's raw (pre-base64) size, for request-budget bookkeeping/tests. */
  sizeBytes: number;
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/**
 * Decodes `file` in the browser, resizes it to fit `COMPRESSION_MAX_LONG_EDGE`,
 * and re-encodes as JPEG, trying progressively lower quality until the
 * result fits `COMPRESSION_TARGET_BYTES` (or the lowest quality step is
 * reached — real-world photos essentially always fit well before that).
 *
 * `imageOrientation: "from-image"` asks the browser to apply the photo's
 * own EXIF orientation tag before handing back pixels — the current,
 * browser-native way to do this with no extra library, per MDN's
 * `createImageBitmap` reference; a browser too old to support the option
 * simply ignores it (defaults to "none"), which only risks orientation on
 * a vanishingly rare client, never a hard failure.
 *
 * Throws `ImageCompressionError` (a message safe to show directly) for a
 * source file too large to even attempt, or one the browser can't decode
 * as an image at all — the caller (EstimatorContext's `addPhotos`) treats
 * this exactly like its other per-file validation failures.
 */
export async function compressImageFile(file: File): Promise<CompressedImage> {
  if (file.size > MAX_SOURCE_FILE_BYTES) {
    throw new ImageCompressionError(`${file.name} is too large to process.`);
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new ImageCompressionError(`${file.name} isn't a photo Tallyvis can read.`);
  }

  try {
    const { width, height } = computeTargetDimensions(bitmap.width, bitmap.height, COMPRESSION_MAX_LONG_EDGE);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new ImageCompressionError(`${file.name} could not be processed.`);
    ctx.drawImage(bitmap, 0, 0, width, height);

    let best: Blob | null = null;
    for (const quality of JPEG_QUALITY_STEPS) {
      const blob = await canvasToJpegBlob(canvas, quality);
      if (!blob) continue;
      best = blob;
      if (blob.size <= COMPRESSION_TARGET_BYTES) break;
    }
    if (!best) throw new ImageCompressionError(`${file.name} could not be processed.`);

    const dataUrl = await blobToDataUrl(best);
    return { blob: best, dataUrl, sizeBytes: best.size };
  } finally {
    bitmap.close();
  }
}
