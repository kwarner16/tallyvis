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
          evidence: { coverage: "complete", overallEvidence: "sufficient", issues: [] },
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
    expect(meta?.stopReason).toBe("tool_use");
    expect(meta?.toolUseFound).toBe(true);
  });

  /**
   * 2026-09 "obvious window" incident (docs/decisions/0025), Part 7's own
   * diagnostic requirements: Anthropic's own request id must be captured
   * on a SUCCESSFUL response too (previously only ever captured via
   * `AiProviderError.detail` on a thrown error) — this is exactly the
   * identifier Anthropic's own support asks for when diagnosing a
   * specific past call, and without it a "the model returned something
   * weird but didn't technically error" case had no way to be traced back
   * to a specific request afterward.
   */
  it("captures Anthropic's own request-id header on a successful response", async () => {
    const baseURL = await listen((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json", "request-id": "req_test_diagnostic_123" });
      res.end(JSON.stringify(validToolResponse()));
    });
    const provider = createAnthropicProvider({ apiKey: "test-key", baseURL });

    const { meta } = await provider.analyzeProperty(images, metadata);
    expect(meta?.requestId).toBe("req_test_diagnostic_123");
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

  /**
   * Part 10 of the production-reliability audit (docs/decisions/0022-
   * graceful-partial-ai-analysis.md): multiple photos of the same property
   * must be reasoned about together, not double-counted. Architecturally
   * this was already true — every photo becomes one `image` content block
   * in a single user message of a single `messages.create` call, never one
   * call per photo — this test locks that in so it can't silently regress
   * into a per-photo-then-sum request shape later.
   */
  it("sends every photo as one message in a single request, never one request per photo", async () => {
    let requestCount = 0;
    let receivedBody: string | undefined;
    const baseURL = await listen((req, res) => {
      requestCount++;
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        receivedBody = Buffer.concat(chunks).toString("utf-8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(validToolResponse()));
      });
    });
    const provider = createAnthropicProvider({ apiKey: "test-key", baseURL });
    const multiImages = [
      { url: "data:image/jpeg;base64,AAAA" },
      { url: "data:image/jpeg;base64,BBBB" },
      { url: "data:image/jpeg;base64,CCCC" },
    ];

    await provider.analyzeProperty(multiImages, metadata);

    expect(requestCount).toBe(1);
    const body = JSON.parse(receivedBody!);
    expect(body.messages).toHaveLength(1);
    const imageBlocks = (body.messages[0].content as { type: string }[]).filter((block) => block.type === "image");
    expect(imageBlocks).toHaveLength(3);
  });

  /**
   * Regression for the prompt-ambiguity gaps the same audit found: the
   * original prompt never defined what counts as one "window" (a bay
   * window's multiple sashes? a glass door?) and never told the model its
   * photos are overlapping views of one property rather than independent
   * ones — see this file's SYSTEM_PROMPT.
   */
  it("defines what counts as one window and instructs against double-counting across overlapping photos", async () => {
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
    await provider.analyzeProperty(images, metadata);

    const body = JSON.parse(receivedBody!);
    const system = body.system as string;
    expect(system).toMatch(/do not count doors as windows/i);
    expect(system).toMatch(/bay.*counts as one window/is);
    expect(system).toMatch(/same property, not separate properties/i);
    expect(system).toMatch(/count that window only once/i);
  });

  /**
   * Vision V1.1 (docs/decisions/0023-guided-capture-evidence-confidence.md)
   * — the production 6-vs-14 miscount: the tool schema must require the
   * model to say structurally, not just in prose, whether the photos show
   * the WHOLE property. Revised in the 2026-09 "obvious window" incident
   * audit (docs/decisions/0025): the original fix for 6-vs-14 accidentally
   * over-corrected by ALSO downgrading windowCount's own "observed" status
   * whenever coverage was incomplete — which meant even a single,
   * completely unambiguous window (the ONLY thing in a close-up photo)
   * could never be "observed", since one photo obviously can't show "the
   * whole property". The current prompt instead keeps these separate:
   * windowCount answers "how many are visible in what was submitted" (can
   * be confidently "observed" even from a single photo), while
   * `evidence.coverage`/`overallEvidence` — still required, still
   * structural, not just prose — is what tells the business the total may
   * be higher. See `scripts/verify-prompt-reasoning.mjs`/`scripts/verify-window-count-against-real-api.mjs`
   * (this incident's own diagnostic scripts) for empirical before/after
   * confirmation against the real Anthropic API.
   */
  it("requires a structured evidence assessment, and tells the model windowCount means what's visible in the submitted photos — not the property's total", async () => {
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
    await provider.analyzeProperty(images, metadata);

    const body = JSON.parse(receivedBody!);
    const system = body.system as string;
    // windowCount is "observed" for what's visible, even from a single
    // photo — the property-total question is answered SEPARATELY, by the
    // required evidence fields below, never by downgrading windowCount.
    expect(system).toMatch(/windowcount.*answers one question/is);
    expect(system).toMatch(/never the different question.*property's total window count/is);
    expect(system).toMatch(/regardless of whether other parts of the property are obscured/i);
    expect(system).toMatch(/unrelated_images/i);

    const tool = body.tools[0];
    expect(tool.input_schema.required).toContain("evidence");
    const evidenceSchema = tool.input_schema.properties.evidence;
    expect(evidenceSchema.required).toEqual(expect.arrayContaining(["coverage", "overallEvidence"]));
    expect(evidenceSchema.properties.overallEvidence.enum).toEqual([
      "sufficient",
      "usable_with_uncertainty",
      "insufficient",
    ]);
  });

  /**
   * 2026-09 "obvious window" incident (docs/decisions/0025): a real human
   * acceptance test submitted exactly one indoor close-up photo of one
   * clearly visible window and got back no usable windowCount at all —
   * traced (via `scripts/verify-prompt-reasoning.mjs` against the real Anthropic
   * API) to the previous wording's "only use observed when confident the
   * visible windows ARE the property's total", which structurally cannot
   * ever be true for a single non-overview photo. This asserts the exact
   * corrected instruction is present, and that "uncertain" is defined to
   * still carry a best-guess value rather than silently becoming "no
   * number" — the second, compounding half of the same incident (a real
   * `analyzeProperty` call against the live API, before this fix, returned
   * `windowCount: { status: "uncertain", confidence: "medium" }` with NO
   * `value` field at all for an unambiguous single-window photo).
   */
  it("tells the model a single photo of one clearly visible window is fully answerable as 'observed', and that 'uncertain' must still carry a best-guess value", async () => {
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
    await provider.analyzeProperty(images, metadata);

    const system = JSON.parse(receivedBody!).system as string;
    expect(system).toMatch(/close-up\s+window with nothing else of the building visible, is completely normal/i);
    expect(system).toMatch(/windowcount is "observed"\s+with value 1/i);
    expect(system).toMatch(/always attach your best-guess "value" rather than omitting it/i);
    expect(system).toMatch(/uncertain"\s+means\s+"this number might be off",\s+never\s+"no number/i);
  });

  /**
   * Regression (confirmed in production, 2026-09-24): Anthropic's strict
   * tool-use validation rejects an empty `{}` JSON Schema — the shape
   * `report_property_observation`'s `value` field used, meant as "accepts
   * any JSON value" — with `invalid_request_error: "Empty schema ({})
   * that accepts any JSON value is not supported. Please specify a
   * concrete type."` No existing test caught this because the fake server
   * above never validates the schema it's sent, only what it's told to
   * respond with — this test instead inspects the actual tool definition
   * bytes going out over the wire for exactly the shape Anthropic rejects.
   */
  it("never sends a bare empty-object ({}) JSON Schema for any tool input property — Anthropic's strict tool-use validation rejects that shape outright", async () => {
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
    await provider.analyzeProperty(images, metadata);

    const body = JSON.parse(receivedBody!);
    const tool = body.tools[0];
    expect(tool.name).toBe("report_property_observation");

    function assertNoEmptySchema(schema: unknown, path: string): void {
      if (typeof schema !== "object" || schema === null) return;
      const record = schema as Record<string, unknown>;
      if (Object.keys(record).length === 0) {
        expect.unreachable(`Empty {} JSON Schema at ${path} — Anthropic rejects this; specify a concrete "type".`);
      }
      const properties = record.properties as Record<string, unknown> | undefined;
      if (properties) {
        for (const [key, value] of Object.entries(properties)) {
          assertNoEmptySchema(value, `${path}.properties.${key}`);
        }
      }
    }

    assertNoEmptySchema(tool.input_schema, "input_schema");
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

  it("distinguishes an invalid/unsupported model (404 not_found_error) from a generic provider error", async () => {
    const baseURL = await listen((req, res) => {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "not_found_error", message: "model: claude-bogus-model not found" } }));
    });
    const provider = createAnthropicProvider({ apiKey: "test-key", baseURL });

    await expect(provider.analyzeProperty(images, metadata)).rejects.toThrow(/doesn't recognize the configured model/i);
    // Never the raw provider message, which could echo the exact (possibly misconfigured) model string.
    await expect(provider.analyzeProperty(images, metadata)).rejects.not.toThrow(/claude-bogus-model/);
    await expectCategory(provider.analyzeProperty(images, metadata), "model-not-found");
  });

  it("distinguishes a billing/credit error from a generic provider error or rate-limit", async () => {
    const baseURL = await listen((req, res) => {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "billing_error", message: "credit balance is too low" } }));
    });
    const provider = createAnthropicProvider({ apiKey: "test-key", baseURL });

    await expect(provider.analyzeProperty(images, metadata)).rejects.toThrow(/billing attention/i);
    await expectCategory(provider.analyzeProperty(images, metadata), "billing");
  });

  it("distinguishes an overloaded-model error from this account being rate-limited", async () => {
    const baseURL = await listen((req, res) => {
      res.writeHead(529, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }));
    });
    const provider = createAnthropicProvider({ apiKey: "test-key", baseURL });

    await expect(provider.analyzeProperty(images, metadata)).rejects.toThrow(/temporarily at capacity/i);
    await expectCategory(provider.analyzeProperty(images, metadata), "overloaded");
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

    // Part 7's own diagnostic requirement: "the model responded but didn't
    // call the tool" must be distinguishable, from logs alone, from every
    // other malformed-response cause — see AiProviderError.detail's comment.
    try {
      await provider.analyzeProperty(images, metadata);
      expect.unreachable();
    } catch (err) {
      expect((err as InstanceType<typeof AiProviderError>).detail).toMatch(/toolUseFound=false/);
      expect((err as InstanceType<typeof AiProviderError>).detail).toMatch(/stopReason=end_turn/);
    }
  });

  it("passes through a tool input with a malformed field — the caller's validator degrades it, not a crash here", async () => {
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
    // An absurd windowCount and every other missing field degrade to
    // "unknown" (Phase 12.1 — docs/decisions/0022-graceful-partial-ai-
    // analysis.md) rather than voiding the whole observation, since
    // `vertical` alone is structurally valid.
    const validated = validateRawPropertyObservation(raw);
    expect(validated.ok).toBe(true);
    if (validated.ok) expect(validated.value.windowCount).toEqual({ status: "unknown" });
  });

  it("still fails schema validation outright for genuinely uninterpretable top-level input (wrong vertical)", async () => {
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
                input: { ...validToolResponse().content[0]!.input, vertical: "pressure-washing" },
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
