import { describe, expect, it } from "vitest";
import { mockProvider } from "../providers/mock";
import { runAnalysis } from "../index";
import { validateRawPropertyObservation } from "../validateObservation";
import type { AiProvider } from "../providers/types";

/**
 * End-to-end pipeline tests (provider -> validate -> reconcile) against
 * the mock provider and a set of deliberately broken fake providers —
 * exactly the "provider integration" failure modes the Phase 11 brief
 * calls out: malformed output, provider errors, timeouts, empty/partial
 * responses. `runAnalysis` takes an explicit provider, so none of this
 * needs environment variables or real network access.
 */

const metadata = { vertical: "window-cleaning" as const, customerDeclaredStories: 2 };
const threeImages = [{ url: "data:image/jpeg;base64,AAAA" }, { url: "data:image/jpeg;base64,BBBB" }, { url: "data:image/jpeg;base64,CCCC" }];

describe("mock provider", () => {
  it("produces output that passes strict schema validation", async () => {
    const { raw } = await mockProvider.analyzeProperty(threeImages, metadata);
    const result = validateRawPropertyObservation(raw);
    expect(result.ok).toBe(true);
  });

  it("honestly reports fields it has no real signal for as unknown, never a fabricated observation", async () => {
    const { raw } = await mockProvider.analyzeProperty(threeImages, metadata);
    expect((raw as Record<string, unknown>).hardWaterStaining).toEqual({ status: "unknown" });
  });

  it("reports non-sensitive metadata (model name) alongside its raw output", async () => {
    const { meta } = await mockProvider.analyzeProperty(threeImages, metadata);
    expect(meta?.model).toBeTruthy();
  });

  it("lowers confidence with fewer photos, exactly like the Phase 4 mock it replaces", async () => {
    const fewPhotos = await runAnalysis(mockProvider, [{ url: "data:image/jpeg;base64,AAAA" }], metadata);
    const manyPhotos = await runAnalysis(mockProvider, [1, 2, 3, 4, 5].map((i) => ({ url: `data:image/jpeg;base64,${i}` })), metadata);
    expect(fewPhotos.analysis.metadata.confidence).toBe("low");
    expect(manyPhotos.analysis.metadata.confidence).toBe("high");
  });
});

describe("runAnalysis — full pipeline via a fake provider", () => {
  it("returns both the reconciled analysis and the validated raw observation", async () => {
    const result = await runAnalysis(mockProvider, threeImages, metadata);
    expect(result.analysis.characteristics.vertical).toBe("window-cleaning");
    expect(result.observation.vertical).toBe("window-cleaning");
  });

  it("rejects malformed provider output before it can reach reconciliation", async () => {
    const brokenProvider: AiProvider = {
      name: "broken",
      analyzeProperty: async () => ({ raw: { not: "a valid observation" } }),
    };
    await expect(runAnalysis(brokenProvider, threeImages, metadata)).rejects.toThrow(/invalid result/i);
  });

  it("rejects a non-JSON-object provider response (e.g. a raw string)", async () => {
    const stringProvider: AiProvider = { name: "string-returning", analyzeProperty: async () => ({ raw: "I saw a house." }) };
    await expect(runAnalysis(stringProvider, threeImages, metadata)).rejects.toThrow(/invalid result/i);
  });

  it("rejects an empty response", async () => {
    const emptyProvider: AiProvider = { name: "empty", analyzeProperty: async () => ({ raw: undefined }) };
    await expect(runAnalysis(emptyProvider, threeImages, metadata)).rejects.toThrow();
  });

  it("accepts a partial response missing most fields — graceful degradation, not wholesale rejection", async () => {
    // Phase 12.1 (docs/decisions/0022-graceful-partial-ai-analysis.md): a
    // response missing most fields is structurally valid (correct
    // `vertical`) and reaches the human reviewer with everything it
    // legitimately lacks marked unknown and defaulted, rather than being
    // discarded outright the way a genuinely corrupt response still is.
    const partialProvider: AiProvider = {
      name: "partial",
      analyzeProperty: async () => ({ raw: { vertical: "window-cleaning", stories: { status: "unknown" } } }),
    };
    const result = await runAnalysis(partialProvider, threeImages, metadata);
    expect(result.observation.windowCount).toEqual({ status: "unknown" });
    expect(result.analysis.metadata.confidence).toBe("low");
    expect(result.analysis.characteristics.stories).toBe(metadata.customerDeclaredStories);
  });

  it("still rejects a genuinely uninterpretable response outright (wrong vertical)", async () => {
    const wrongVerticalProvider: AiProvider = {
      name: "wrong-vertical",
      analyzeProperty: async () => ({ raw: { vertical: "pressure-washing" } }),
    };
    await expect(runAnalysis(wrongVerticalProvider, threeImages, metadata)).rejects.toThrow(/invalid result/i);
  });

  it("propagates a provider error as a clean Error, never crashes the caller", async () => {
    const failingProvider: AiProvider = {
      name: "failing",
      analyzeProperty: async () => {
        throw new Error("connection refused");
      },
    };
    await expect(runAnalysis(failingProvider, threeImages, metadata)).rejects.toThrow("connection refused");
  });

  it("propagates a timeout-like rejection cleanly", async () => {
    const timeoutProvider: AiProvider = {
      name: "timeout",
      analyzeProperty: () => new Promise((_, reject) => reject(new Error("The AI provider did not respond in time."))),
    };
    await expect(runAnalysis(timeoutProvider, threeImages, metadata)).rejects.toThrow(/did not respond in time/);
  });

  it("handles a non-Error throw (e.g. a string or object thrown by a misbehaving provider) without crashing", async () => {
    const weirdProvider: AiProvider = {
      name: "weird",
      analyzeProperty: async () => {
        // Deliberately simulating a misbehaving provider that throws a non-Error value.
        throw "not an Error instance";
      },
    };
    await expect(runAnalysis(weirdProvider, threeImages, metadata)).rejects.toThrow();
  });

  it("never lets AI output directly supply a quote total, price, rate, or multiplier — the pipeline's return value contains no such field at any level", async () => {
    const suspiciousProvider: AiProvider = {
      name: "suspicious",
      analyzeProperty: async () => {
        const good = await mockProvider.analyzeProperty(threeImages, metadata);
        // Even if a rogue/compromised provider tries to smuggle pricing fields in, validation strips anything not in the schema.
        return { raw: { ...(good.raw as object), totalPrice: 1875, hourlyRate: 50, total: 999 } };
      },
    };
    const result = await runAnalysis(suspiciousProvider, threeImages, metadata);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/totalPrice|hourlyRate|1875/);
  });
});
