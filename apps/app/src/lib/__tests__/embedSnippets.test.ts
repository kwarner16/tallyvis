import { describe, expect, it } from "vitest";
import { buildIframeSnippet, buildScriptSnippet } from "../embedSnippets";

const ORIGIN = "https://app.tallyvis.com";
const EMBED_ID = "a1b2c3d4e5f6a1b2c3d4e5f6";
const INTERNAL_BUSINESS_ID = "business_should_never_appear_here";

describe("buildScriptSnippet", () => {
  it("contains the given origin and public embed id", () => {
    const snippet = buildScriptSnippet(ORIGIN, EMBED_ID);
    expect(snippet).toContain(ORIGIN);
    expect(snippet).toContain(EMBED_ID);
    expect(snippet).toContain(`${ORIGIN}/embed.js`);
    expect(snippet).toContain(`data-tallyvis-id="${EMBED_ID}"`);
  });

  it("never contains anything other than the public embed id as an identifier", () => {
    const snippet = buildScriptSnippet(ORIGIN, EMBED_ID);
    expect(snippet).not.toContain(INTERNAL_BUSINESS_ID);
  });
});

describe("buildIframeSnippet", () => {
  it("contains the given origin and public embed id, pointed at the /embed/[id] route", () => {
    const snippet = buildIframeSnippet(ORIGIN, EMBED_ID);
    expect(snippet).toContain(`${ORIGIN}/embed/${EMBED_ID}`);
    expect(snippet).toMatch(/^<iframe /);
  });

  it("never contains anything other than the public embed id as an identifier", () => {
    const snippet = buildIframeSnippet(ORIGIN, EMBED_ID);
    expect(snippet).not.toContain(INTERNAL_BUSINESS_ID);
  });
});
