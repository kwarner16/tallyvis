import { createServer } from "node:http";
import type { RequestListener, Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createAnthropicProvider } from "../providers/anthropic";
import { AiProviderError } from "../providers/types";
import { validateRawPropertyObservation } from "../validateObservation";

/**
 * The real provider adapter, verified against a local fake HTTP server
 * standing in for the Anthropic API — not the live API (no credentials
 * exist in this environment; see
 * docs/decisions/0013-ai-analysis-foundation.md for exactly what this
 * does and does not prove). This exercises the *real* `@anthropic-ai/sdk`
 * client end-to-end: request construction, response parsing, and the
 * SDK's own typed-error mapping — a local server proves more than mocking
 * `fetch` would, without needing real network access or a key.
 */

const metadata = { vertical: "window-cleaning" as const };
const images = [{ url: "data:image/jpeg;base64,AAAA" }];

let server: Server | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

function listen(handler: RequestListener): Promise<string> {
  return new Promise((resolve) => {
    server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const address = server!.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

function validToolResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 50 },
    content: [
      {
        type: "tool_use",
        id: "toolu_test",
        name: "report_property_observation",
        input: {
          vertical: "window-cleaning",
          stories: { status: "observed", value: 2, confidence: "high" },
          windowCount: { status: "observed", value: 24, confidence: "medium" },
          windowType: { status: "observed", value: "double-hung", confidence: "medium" },
          screens: { status: "observed", value: 10, confidence: "medium" },
          tracks: { status: "observed", value: 10, confidence: "medium" },
          accessibility: { status: "uncertain", confidence: "low" },
          condition: { status: "observed", value: "good", confidence: "high" },
          hardWaterStaining: { status: "unknown" },
          overallConfidence: "medium",
          warnings: [],
        },
      },
    ],
    ...overrides,
  };
}

describe("createAnthropicProvider — configuration", () => {
  it("throws immediately if no API key is configured — never attempts a network call", () => {
    expect(() => createAnthropicProvider({ apiKey: "" })).toThrow(/not configured/i);
  });

  it("tags the configuration error with the \"not-configured\" category", () => {
    try {
      createAnthropicProvider({ apiKey: "" });
      expect.unreachable("createAnthropicProvider should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AiProviderError);
      expect((err as AiProviderError).category).toBe("not-configured");
    }
  });
});

describe("createAnthropicProvider — successful response", () => {
  it("returns a raw observation that passes schema validation", async () => {
    const baseURL = await listen((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(validToolResponse()));
    });
    const provider = createAnthropicProvider({ apiKey: "test-key", baseURL });

    const { raw } = await provider.analyzeProperty(images, metadata);
    const validated = validateRawPropertyObservation(raw);
    expect(validated.ok).toBe(true);
  });

  it("reports non-sensitive metadata — model name and token usage — from the response", async () => {
    const baseURL = await listen((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(validToolResponse()));
    });
    const provider = createAnthropicProvider({ apiKey: "test-key", baseURL });

    const { meta } = await provider.analyzeProperty(images, metadata);
    expect(meta?.model).toBe("claude-sonnet-5");
    expect(meta?.inputTokens).toBe(100);
    expect(meta?.outputTokens).toBe(50);
  });

  it("sends the API key and never sends it in a way a response could echo back", async () => {
    let receivedApiKeyHeader: string | undefined;
    const baseURL = await listen((req, res) => {
      receivedApiKeyHeader = req.headers["x-api-key"] as string | undefined;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(validToolResponse()));
    });
    const provider = createAnthropicProvider({ apiKey: "secret-test-key-12345", baseURL });

    const { raw } = await provider.analyzeProperty(images, metadata);
    expect(receivedApiKeyHeader).toBe("secret-test-key-12345");
    expect(JSON.stringify(raw)).not.toContain("secret-test-key-12345");
  });

  it("never includes authentication/session material in the constructed prompt", async () => {
    let receivedBody: string | undefined;
    const baseURL = await listen((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        receivedBody = Buffer.concat(chunks).toString("utf-8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(validToolResponse()));
      });
    });
    const provider = createAnthropicProvider({ apiKey: "test-key", baseURL });
    await provider.analyzeProperty(images, { ...metadata, address: "123 Main St" });

    expect(receivedBody).toBeTruthy();
    for (const forbidden of ["password", "session", "tallyvis_session", "token_hash"]) {
      expect(receivedBody!.toLowerCase()).not.toContain(forbidden);
    }
  });
});

/** Resolves the rejection and asserts it's an `AiProviderError` tagged with `category` — the signal Phase 12's dev logging and UI error messages both key off of (docs/decisions/0014-ai-real-world-refinement.md). */
async function expectCategory(promise: Promise<unknown>, category: string): Promise<void> {
  await promise.then(
    () => expect.unreachable("expected the promise to reject"),
    (err: unknown) => {
      expect(err).toBeInstanceOf(AiProviderError);
      expect((err as AiProviderError).category).toBe(category);
    },
  );
}

describe("createAnthropicProvider — provider failure modes", () => {
  it("throws a clean error on a 401 (invalid credentials) — never a raw provider error string", async () => {
    const baseURL = await listen((req, res) => {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }));
    });
    const provider = createAnthropicProvider({ apiKey: "bad-key", baseURL });

    await expect(provider.analyzeProperty(images, metadata)).rejects.toThrow(/credentials/i);
    await expectCategory(provider.analyzeProperty(images, metadata), "authentication");
  });

  it("throws a clean error on a 429 (rate limited)", async () => {
    const baseURL = await listen((req, res) => {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "rate limited" } }));
    });
    const provider = createAnthropicProvider({ apiKey: "test-key", baseURL });

    await expect(provider.analyzeProperty(images, metadata)).rejects.toThrow(/rate-limiting/i);
    await expectCategory(provider.analyzeProperty(images, metadata), "rate-limit");
  });

  it("throws a clean error on a 500 (provider outage)", async () => {
    const baseURL = await listen((req, res) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "internal error" } }));
    });
    const provider = createAnthropicProvider({ apiKey: "test-key", baseURL });

    await expect(provider.analyzeProperty(images, metadata)).rejects.toThrow(/error/i);
    await expectCategory(provider.analyzeProperty(images, metadata), "provider-error");
  });

  it("times out rather than hanging forever when the provider never responds", async () => {
    const baseURL = await listen(() => {
      // Never respond.
    });
    const provider = createAnthropicProvider({ apiKey: "test-key", baseURL, timeoutMs: 200 });

    await expectCategory(provider.analyzeProperty(images, metadata), "timeout");
  }, 10_000);

  it("throws a clean error when the model refuses instead of analyzing", async () => {
    const baseURL = await listen((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(validToolResponse({ stop_reason: "refusal", content: [] })));
    });
    const provider = createAnthropicProvider({ apiKey: "test-key", baseURL });

    await expect(provider.analyzeProperty(images, metadata)).rejects.toThrow(/declined/i);
    await expectCategory(provider.analyzeProperty(images, metadata), "refusal");
  });

  it("throws a clean error when the response has no tool_use block at all (a malformed/unexpected model response)", async () => {
    const baseURL = await listen((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          validToolResponse({ stop_reason: "end_turn", content: [{ type: "text", text: "I looked at the photos." }] }),
        ),
      );
    });
    const provider = createAnthropicProvider({ apiKey: "test-key", baseURL });

    await expect(provider.analyzeProperty(images, metadata)).rejects.toThrow(/did not return a structured result/i);
    await expectCategory(provider.analyzeProperty(images, metadata), "malformed-response");
  });

  it("passes through a tool input that fails schema validation — the caller's validator catches it, not a crash here", async () => {
    const baseURL = await listen((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          validToolResponse({
            content: [
              {
                type: "tool_use",
                id: "toolu_test",
                name: "report_property_observation",
                input: { vertical: "window-cleaning", windowCount: { status: "observed", value: -999, confidence: "high" } },
              },
            ],
          }),
        ),
      );
    });
    const provider = createAnthropicProvider({ apiKey: "test-key", baseURL });

    const { raw } = await provider.analyzeProperty(images, metadata);
    expect(validateRawPropertyObservation(raw).ok).toBe(false);
  });

  it("handles an empty response body safely", async () => {
    const baseURL = await listen((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("");
    });
    const provider = createAnthropicProvider({ apiKey: "test-key", baseURL });

    await expect(provider.analyzeProperty(images, metadata)).rejects.toThrow();
  });
});
