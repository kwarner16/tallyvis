import { describe, expect, it } from "vitest";
import {
  compressImageFile,
  computeTargetDimensions,
  estimateBase64Bytes,
  ImageCompressionError,
  MAX_SOURCE_FILE_BYTES,
  COMPRESSION_MAX_LONG_EDGE,
  COMPRESSION_TARGET_BYTES,
} from "../imageCompression";
import { windowCleaningEstimatorConfig } from "../estimator/industry-config";

/**
 * Unit tests for the pure, DOM-free policy this module's actual
 * compression decisions are built from — deliberately not mocking
 * `createImageBitmap`/`canvas` (this test environment has no DOM at all;
 * see vitest.config.ts's `environment: "node"`) just to exercise the same
 * arithmetic indirectly. `compressImageFile`'s one DOM-free code path (the
 * oversized-source-file rejection, which returns before ever touching the
 * DOM) is covered directly below; the rest of that function is exercised
 * in a real browser as part of manual/production verification, not here.
 */

describe("computeTargetDimensions", () => {
  it("leaves an image already within the max long edge untouched", () => {
    expect(computeTargetDimensions(800, 600, 1568)).toEqual({ width: 800, height: 600 });
    expect(computeTargetDimensions(1568, 1000, 1568)).toEqual({ width: 1568, height: 1000 });
  });

  it("scales down a landscape image so the long edge matches the max, preserving aspect ratio", () => {
    // A common 4:3 phone photo, well above the resize target.
    const result = computeTargetDimensions(4032, 3024, 1568);
    expect(Math.max(result.width, result.height)).toBe(1568);
    expect(result.width / result.height).toBeCloseTo(4032 / 3024, 2);
  });

  it("scales down a portrait image the same way", () => {
    const result = computeTargetDimensions(3024, 4032, 1568);
    expect(Math.max(result.width, result.height)).toBe(1568);
    expect(result.height / result.width).toBeCloseTo(4032 / 3024, 2);
  });

  it("never produces a zero or negative dimension for an extreme aspect ratio", () => {
    const result = computeTargetDimensions(10000, 1, 1568);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
  });

  it("is a no-op for a zero-size input rather than dividing by zero", () => {
    expect(computeTargetDimensions(0, 0, 1568)).toEqual({ width: 0, height: 0 });
  });
});

describe("estimateBase64Bytes", () => {
  it("matches the standard base64 expansion ratio (4/3, rounded up to a multiple of 4)", () => {
    expect(estimateBase64Bytes(3)).toBe(4);
    expect(estimateBase64Bytes(300 * 1024)).toBe(Math.ceil((300 * 1024) / 3) * 4);
  });
});

describe("request-budget accounting (Part 5 of the mission: keep the whole request safely under Vercel's 4.5MB ceiling)", () => {
  it("the worst case — every photo hitting the compression target — stays comfortably under the 4.5MB platform ceiling", () => {
    const maxPhotos = windowCleaningEstimatorConfig.maxPhotos;
    const worstCaseRawTotal = maxPhotos * COMPRESSION_TARGET_BYTES;
    const worstCaseEncodedTotal = estimateBase64Bytes(worstCaseRawTotal);
    const VERCEL_HARD_LIMIT_BYTES = 4.5 * 1024 * 1024;

    expect(worstCaseEncodedTotal).toBeLessThan(VERCEL_HARD_LIMIT_BYTES);
    // Leaves real headroom for JSON/property metadata and Flight framing overhead — not just barely under.
    expect(VERCEL_HARD_LIMIT_BYTES - worstCaseEncodedTotal).toBeGreaterThan(300 * 1024);
  });

  it("the resize target matches Anthropic's own documented max useful resolution for the standard tier", () => {
    // https://platform.claude.com/docs/en/build-with-claude/vision — "Standard" tier max long edge.
    expect(COMPRESSION_MAX_LONG_EDGE).toBe(1568);
  });
});

describe("compressImageFile — oversized source file", () => {
  it("rejects a source file over MAX_SOURCE_FILE_BYTES with a safe message, before ever touching the DOM", async () => {
    const hugeFile = { name: "huge.jpg", size: MAX_SOURCE_FILE_BYTES + 1 } as File;
    await expect(compressImageFile(hugeFile)).rejects.toBeInstanceOf(ImageCompressionError);
    await expect(compressImageFile(hugeFile)).rejects.toThrow(/too large to process/);
  });

  it("does not reject a file exactly at MAX_SOURCE_FILE_BYTES on size alone (the boundary is `>`, not `>=`)", async () => {
    // This environment has no DOM (see this file's own header), so the size
    // gate passing means it falls through to `createImageBitmap`, which
    // doesn't exist here — a different, later failure than the size
    // rejection, proving the size check itself let this exact boundary
    // value through rather than off-by-one rejecting it.
    const atLimitFile = { name: "at-limit.jpg", size: MAX_SOURCE_FILE_BYTES } as File;
    await expect(compressImageFile(atLimitFile)).rejects.toThrow(/isn't a photo Tallyvis can read/);
  });
});
