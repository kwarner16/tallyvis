import { describe, expect, it } from "vitest";
import { readCachedEmbedId, writeCachedEmbedId, clearCachedEmbedId, shouldBlockEstimator } from "../EstimatorContext";

/**
 * Pure, DOM-free tests for the embed-id cache's storage functions
 * (2026-09 incident — see EMBED_ID_STORAGE_KEY's own comment). This test
 * environment has no real `sessionStorage`/`localStorage` (see
 * vitest.config.ts's `environment: "node"`), so these functions are
 * exercised against a plain in-memory fake implementing the same
 * `getItem`/`setItem`/`removeItem` shape — the same pattern
 * imageCompression.test.ts already uses for DOM-adjacent logic.
 *
 * The regression these tests encode: none of these functions take, or
 * branch on, any notion of "is this running inside an iframe right now."
 * The previous bug was exactly that kind of frame-context branching
 * (`window.self !== window.top`) gating whether a cached embed id was
 * ever read back — it silently broke a legitimate top-level visit to
 * `/embed/[embedId]`. These functions' signatures alone guarantee that
 * class of bug can't reappear here: there is no parameter to branch on.
 */
function createFakeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  } as Storage;
}

describe("readCachedEmbedId / writeCachedEmbedId / clearCachedEmbedId", () => {
  it("round-trips a written id back out of the same storage", () => {
    const storage = createFakeStorage();
    writeCachedEmbedId(storage, "embed_abc123");
    expect(readCachedEmbedId(storage)).toBe("embed_abc123");
  });

  it("returns null when nothing has been cached yet", () => {
    const storage = createFakeStorage();
    expect(readCachedEmbedId(storage)).toBeNull();
  });

  it("clears the cached id so a subsequent read returns null", () => {
    const storage = createFakeStorage();
    writeCachedEmbedId(storage, "embed_abc123");
    clearCachedEmbedId(storage);
    expect(readCachedEmbedId(storage)).toBeNull();
  });

  it("a later write overwrites (not appends to) the same key", () => {
    const storage = createFakeStorage();
    writeCachedEmbedId(storage, "embed_first");
    writeCachedEmbedId(storage, "embed_second");
    expect(readCachedEmbedId(storage)).toBe("embed_second");
  });

  it("two independent storages (modeling two separate tabs/sessions) never see each other's cached id — the invariant sessionStorage provides that the removed iframe check used to approximate", () => {
    const tabA = createFakeStorage();
    const tabB = createFakeStorage();
    writeCachedEmbedId(tabA, "embed_from_tab_a");
    expect(readCachedEmbedId(tabB)).toBeNull();
  });
});

/**
 * 2026-09 "lost tenant identity" incident (docs/decisions/0026): a real
 * production quote landed on an unrelated business because a cached embed
 * id that failed re-verification (`verifyEmbedIdAction` returning `false`
 * for BOTH "confirmed invalid" and "an unexpected error occurred") was
 * silently treated as "no embed at all," letting the session fall through
 * to the bare-estimator default-business path. This is the tenant-isolation
 * invariant that closes it: once a cached embed id existed for this
 * session, ONLY a confirmed-valid verification may let the estimator
 * proceed — anything else (confirmed invalid, OR an unknown/transient
 * error) must block, never silently degrade to "no tenant."
 */
describe("shouldBlockEstimator — tenant-isolation invariant", () => {
  it("never blocks a genuinely bare session (no cached embed id at all) — the documented, accepted bare-estimator fallback must keep working", () => {
    expect(shouldBlockEstimator(false, null)).toBe(false);
    expect(shouldBlockEstimator(false, false)).toBe(false);
    expect(shouldBlockEstimator(false, true)).toBe(false);
  });

  it("does not block once a cached embed id is confirmed valid", () => {
    expect(shouldBlockEstimator(true, true)).toBe(false);
  });

  it("blocks when a cached embed id is confirmed INVALID — never silently falls through to a default business", () => {
    expect(shouldBlockEstimator(true, false)).toBe(true);
  });

  it("blocks when a cached embed id's verification hit an unknown/transient error — this is the exact case the incident traced: an error must never be treated as 'no embed'", () => {
    expect(shouldBlockEstimator(true, null)).toBe(true);
  });
});
