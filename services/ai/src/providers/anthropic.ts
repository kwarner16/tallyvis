import Anthropic from "@anthropic-ai/sdk";
import type { PropertyImage, PropertyMetadata } from "@tallyvis/types";
import type { AiProvider } from "./types";

/**
 * The real computer-vision provider — Anthropic's Claude, via the
 * official SDK's vision + strict tool-use features. See
 * docs/decisions/0013-ai-analysis-foundation.md for why Claude, why tool
 * use rather than free-text JSON, and what is/isn't verified against the
 * live API in this environment (no credentials configured here).
 *
 * Deliberately pure w.r.t. configuration: every value this needs
 * (`apiKey`, `model`, `baseURL`, `timeoutMs`) is passed in explicitly by
 * the caller (`index.ts`, which reads the environment once) rather than
 * read from `process.env` in here — keeps this file testable against a
 * local fake HTTP server with no environment coupling, and keeps exactly
 * one place in the package responsible for env resolution.
 */

export interface AnthropicProviderConfig {
  apiKey: string;
  model?: string;
  baseURL?: string;
  /** Per-request timeout — a hung provider call must not hang the caller forever. */
  timeoutMs?: number;
}

const DEFAULT_MODEL = "claude-sonnet-5";
const DEFAULT_TIMEOUT_MS = 30_000;

const TOOL_NAME = "report_property_observation";

/**
 * A generous, deliberately loose JSON Schema — it constrains shape and
 * primitive types, not the full "status implies these fields" business
 * rules (JSON Schema's `if`/`then` support for this is thin, and Claude's
 * structured/strict tool use only needs to bias generation toward roughly
 * the right shape). `validateRawPropertyObservation` is what actually
 * enforces correctness; this schema is not trusted as validation on its
 * own — see that file's own comment.
 */
const OBSERVED_VALUE_SCHEMA = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["observed", "uncertain", "unknown"] },
    value: {},
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: ["status"],
  additionalProperties: false,
} as const;

const REPORT_TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description:
    "Report structured observations about a residential property's windows from the provided photos, for a window-cleaning estimate. For any field you cannot confidently determine from the photos, use status \"unknown\" or \"uncertain\" rather than guessing a specific value — the business will review and correct these before pricing.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      vertical: { type: "string", enum: ["window-cleaning"] },
      propertyType: OBSERVED_VALUE_SCHEMA,
      stories: OBSERVED_VALUE_SCHEMA,
      windowCount: OBSERVED_VALUE_SCHEMA,
      windowType: OBSERVED_VALUE_SCHEMA,
      screens: OBSERVED_VALUE_SCHEMA,
      tracks: OBSERVED_VALUE_SCHEMA,
      accessibility: OBSERVED_VALUE_SCHEMA,
      condition: OBSERVED_VALUE_SCHEMA,
      hardWaterStaining: OBSERVED_VALUE_SCHEMA,
      overallConfidence: { type: "string", enum: ["high", "medium", "low"] },
      warnings: { type: "array", items: { type: "string" } },
    },
    required: [
      "vertical",
      "propertyType",
      "stories",
      "windowCount",
      "windowType",
      "screens",
      "tracks",
      "accessibility",
      "condition",
      "hardWaterStaining",
      "overallConfidence",
    ],
    additionalProperties: false,
  },
};

const SYSTEM_PROMPT =
  "You are analyzing photos of a residential property's exterior for a window-cleaning company. " +
  "Report what you can actually see using the report_property_observation tool. Never invent a " +
  "specific count or value you cannot support from the photos — use \"uncertain\" when you can " +
  "estimate but aren't sure, and \"unknown\" when a photo simply doesn't show enough to say " +
  "anything. You are not setting a price; you are only describing what is visible.";

/** Parses a `data:image/...;base64,...` URI into the parts Claude's vision input needs. Returns `undefined` for anything else (a bare http(s) URL, a blob: URL, malformed data) — the caller decides how to handle that. */
function parseDataUrl(url: string): { mediaType: string; data: string } | undefined {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/.exec(url);
  if (!match) return undefined;
  const [, mediaType, data] = match;
  return mediaType && data ? { mediaType, data } : undefined;
}

function buildUserContent(images: PropertyImage[], metadata: PropertyMetadata): Anthropic.MessageParam["content"] {
  const content: Anthropic.ContentBlockParam[] = [];

  for (const image of images) {
    const parsed = parseDataUrl(image.url);
    if (!parsed) continue; // a non-data-URI image (e.g. a stale blob: URL) simply can't be sent — skip rather than fail the whole analysis.
    content.push({
      type: "image",
      source: { type: "base64", media_type: parsed.mediaType as Anthropic.Base64ImageSource["media_type"], data: parsed.data },
    });
  }

  const details = [
    metadata.address ? `Address: ${metadata.address}` : null,
    metadata.customerDeclaredStories ? `Customer reports the property has ${metadata.customerDeclaredStories} stor${metadata.customerDeclaredStories === 1 ? "y" : "ies"} (verify independently from the photos rather than trusting this).` : null,
  ].filter((line): line is string => line !== null);

  content.push({
    type: "text",
    text:
      details.length > 0
        ? `${details.join("\n")}\n\nAnalyze the property photos above and call report_property_observation.`
        : "Analyze the property photos above and call report_property_observation.",
  });

  return content;
}

/**
 * Maps SDK-level failures to a small set of clear, non-leaking error
 * messages — never a raw provider error string (which could echo request
 * details) and never the API key.
 */
function describeFailure(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return "The AI provider rejected the configured credentials.";
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "The AI provider is rate-limiting requests right now.";
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return "The AI provider did not respond in time.";
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return "Could not reach the AI provider.";
  }
  if (err instanceof Anthropic.APIError) {
    return `The AI provider returned an error (status ${err.status ?? "unknown"}).`;
  }
  return "The AI provider request failed.";
}

export function createAnthropicProvider(config: AnthropicProviderConfig): AiProvider {
  if (!config.apiKey) {
    throw new Error("AI_PROVIDER_API_KEY is not configured.");
  }

  const client = new Anthropic({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    timeout: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
  const model = config.model ?? DEFAULT_MODEL;

  async function analyzeProperty(images: PropertyImage[], metadata: PropertyMetadata): Promise<unknown> {
    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        tools: [REPORT_TOOL],
        tool_choice: { type: "tool", name: TOOL_NAME },
        messages: [{ role: "user", content: buildUserContent(images, metadata) }],
      });
    } catch (err) {
      throw new Error(describeFailure(err));
    }

    if (response.stop_reason === "refusal") {
      throw new Error("The AI declined to analyze these photos.");
    }

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === TOOL_NAME,
    );
    if (!toolUse) {
      throw new Error("The AI did not return a structured result.");
    }

    // `toolUse.input` is already JSON-parsed by the SDK for a non-streaming
    // response — still `unknown` from this file's point of view, and still
    // subject to `validateRawPropertyObservation` by the caller before
    // anything trusts its shape.
    return toolUse.input;
  }

  return { name: "anthropic", analyzeProperty };
}
