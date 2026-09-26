import { describe, expect, it } from "vitest";
import { readCachedEmbedId, writeCachedEmbedId, clearCachedEmbedId } from "../EstimatorContext";

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
