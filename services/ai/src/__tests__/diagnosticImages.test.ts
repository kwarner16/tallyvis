import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { maybeWriteDiagnosticImages } from "../index";

/**
 * 2026-09 "obvious window" incident (docs/decisions/0025) — Part 6's
 * requested diagnostic mechanism: write the exact compressed bytes about
 * to be sent to Anthropic to local disk, so a developer can visually
 * compare "original photo" vs. "what the model actually received."
 * Deliberately narrow and safe: off by default, hard-blocked in
 * production regardless of the env var, writes to local disk only, and
 * never logs the image content itself.
 */

describe("maybeWriteDiagnosticImages", () => {
  let dir: string;
  const originalEnv = { dir: process.env.AI_DIAGNOSTIC_IMAGE_DIR, nodeEnv: process.env.NODE_ENV };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "tallyvis-ai-diag-test-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    if (originalEnv.dir === undefined) delete process.env.AI_DIAGNOSTIC_IMAGE_DIR;
    else process.env.AI_DIAGNOSTIC_IMAGE_DIR = originalEnv.dir;
    if (originalEnv.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv.nodeEnv;
  });

  const tinyPngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

  it("does nothing when AI_DIAGNOSTIC_IMAGE_DIR is not set", () => {
    delete process.env.AI_DIAGNOSTIC_IMAGE_DIR;
    process.env.NODE_ENV = "development";
    maybeWriteDiagnosticImages([{ url: `data:image/png;base64,${tinyPngBase64}` }]);
    expect(fs.existsSync(dir) && fs.readdirSync(dir).length > 0).toBe(false);
  });

  it("is hard-blocked in production even when the env var IS set — the defense-in-depth gate", () => {
    process.env.AI_DIAGNOSTIC_IMAGE_DIR = dir;
    process.env.NODE_ENV = "production";
    maybeWriteDiagnosticImages([{ url: `data:image/png;base64,${tinyPngBase64}` }]);
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  it("writes the exact decoded bytes to the configured directory outside production", () => {
    process.env.AI_DIAGNOSTIC_IMAGE_DIR = dir;
    process.env.NODE_ENV = "test";
    maybeWriteDiagnosticImages([{ url: `data:image/png;base64,${tinyPngBase64}` }]);

    const files = fs.readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.png$/);
    const written = fs.readFileSync(path.join(dir, files[0]!));
    expect(written.equals(Buffer.from(tinyPngBase64, "base64"))).toBe(true);
  });

  it("writes one file per image, preserving each one's own extension", () => {
    process.env.AI_DIAGNOSTIC_IMAGE_DIR = dir;
    process.env.NODE_ENV = "test";
    maybeWriteDiagnosticImages([
      { url: `data:image/png;base64,${tinyPngBase64}` },
      { url: `data:image/jpeg;base64,${tinyPngBase64}` },
    ]);
    const files = fs.readdirSync(dir);
    expect(files).toHaveLength(2);
    expect(files.some((f) => f.endsWith(".png"))).toBe(true);
    expect(files.some((f) => f.endsWith(".jpg"))).toBe(true);
  });

  it("skips (never throws) a non-data-URI image", () => {
    process.env.AI_DIAGNOSTIC_IMAGE_DIR = dir;
    process.env.NODE_ENV = "test";
    expect(() => maybeWriteDiagnosticImages([{ url: "blob:not-a-data-uri" }])).not.toThrow();
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  it("never throws even when the configured directory can't be created", () => {
    process.env.AI_DIAGNOSTIC_IMAGE_DIR = "\0invalid-path";
    process.env.NODE_ENV = "test";
    expect(() => maybeWriteDiagnosticImages([{ url: `data:image/png;base64,${tinyPngBase64}` }])).not.toThrow();
  });
});
