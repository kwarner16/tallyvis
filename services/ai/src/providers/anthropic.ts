import Anthropic, { type APIError } from "@anthropic-ai/sdk";
import type { PropertyImage, PropertyMetadata } from "@tallyvis/types";
import { AiProviderError, type AiProvider, type AiProviderResult } from "./types";

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
    // Confirmed in production (2026-09-24): an empty `{}` schema here — the
    // original, deliberately loose "accepts any JSON value" shape this
    // file's own module comment describes — is rejected outright by
    // Anthropic's strict tool-use validation: "Empty schema ({}) that
    // accepts any JSON value is not supported. Please specify a concrete
    // type." `RawPropertyObservation`'s `ObservedValue<T>` only ever needs
    // `value` to hold a number (stories/windowCount/screens/tracks), a
    // string enum (windowType/accessibility/condition), or a boolean
    // (hardWaterStaining) — listing exactly those three JSON types is
    // still schema-shared across every field using this object (not a
    // per-field schema), just no longer an unconstrained empty object.
    value: { type: ["string", "number", "boolean"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: ["status"],
  additionalProperties: false,
} as const;

/**
 * Vision V1.1 (docs/decisions/0023-guided-capture-evidence-confidence.md)
 * — a real production test (14 actual windows, photographed from across
 * the street with shrubs blocking several) produced a windowCount of ~6
 * with no explicit signal distinguishing "6 is everything visible, and
 * the rest of the property isn't shown" from "6 is the property's total."
 * This schema asks the model to say which one it means, structurally
 * rather than leaving it implicit in a free-text warning. See
 * `EvidenceAssessment`'s own comment in `../types.ts` for what each field
 * means and why `distance`/`visibility` were deliberately NOT split into
 * separate scalar fields alongside `issues`.
 */
const EVIDENCE_SCHEMA = {
  type: "object",
  properties: {
    coverage: { type: "string", enum: ["complete", "partial", "insufficient"] },
    overallEvidence: { type: "string", enum: ["sufficient", "usable_with_uncertainty", "insufficient"] },
    issues: {
      type: "array",
      items: {
        type: "string",
        enum: ["distance", "vegetation", "vehicles", "glare", "darkness", "blur", "cropped_facade", "unrelated_images"],
      },
    },
  },
  required: ["coverage", "overallEvidence"],
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
      evidence: EVIDENCE_SCHEMA,
    },
    required: [
      "vertical",
      "stories",
      "windowCount",
      "windowType",
      "screens",
      "tracks",
      "accessibility",
      "condition",
      "hardWaterStaining",
      "overallConfidence",
      "evidence",
    ],
    additionalProperties: false,
  },
};

/**
 * Phase 12 revision (docs/decisions/0014-ai-real-world-refinement.md):
 * the Phase 11 prompt asked for "uncertain vs. unknown" but never defined
 * what "difficult" access actually means, leaving the single field with
 * the largest price impact (`accessibility` drives `difficultyMultipliers`
 * — see packages/pricing/src/windowCleaning.ts) the least specified. This
 * version gives concrete criteria and explicitly asks that anything
 * affecting access (gates, height, obstructions) also be named in
 * `warnings`, not just folded into a bare "difficult" rating. Not a
 * response to a specific observed failure — no live model calls have been
 * made in this environment (no API key configured here) — this is a
 * clarity improvement from re-reading the original prompt critically, and
 * is labeled as such rather than claimed as a fix for a confirmed bug.
 */
const SYSTEM_PROMPT = [
  "You are analyzing photos of a residential property's exterior for a window-cleaning company.",
  "Report what you can actually see using the report_property_observation tool.",
  "",
  "Never invent a specific count or value you cannot support from the photos:",
  "- Use \"uncertain\" when you can make a reasonable estimate but are not confident in the exact value.",
  "- Use \"unknown\" when the photos simply do not show enough to say anything at all about that field.",
  "- Only use \"observed\" when you can actually see and count/determine the value directly.",
  "",
  "What counts as one \"window\" for windowCount (this is the field the business relies on most,",
  "so be precise about the convention):",
  "- Count each distinct framed window opening as one window.",
  "- A bay, bow, or other multi-sash window grouped in a single frame counts as ONE window, not one",
  "  per sash or pane — do not count individual panes.",
  "- Do NOT count doors as windows, including sliding glass/patio doors and French doors, even though",
  "  they contain glass. If a glass door is relevant to the job, mention it in \"warnings\" instead.",
  "- If a window is partially obscured (by landscaping, an angle, etc.) but you can still tell it's a",
  "  distinct window opening, count it; if you cannot tell whether an obscured area contains one",
  "  window or several, prefer \"uncertain\" over guessing a specific total.",
  "",
  "Multiple photos of the same property (this matters for every count field — windowCount, screens,",
  "tracks):",
  "- All photos provided are different views of the SAME property, not separate properties.",
  "- Reason about them together as one building. If the same window(s) appear in more than one photo",
  "  (e.g. a wider shot and a closer shot of the same elevation), count that window only once —",
  "  never sum per-photo counts, which double-counts overlapping views.",
  "- If the photos together don't show every side of the property, do not assume unseen sides match",
  "  what you can see — use \"uncertain\" for counts you're extrapolating, and say what's missing in",
  "  \"warnings\" (e.g. \"the rear of the property is not visible in any photo\").",
  "",
  "Accessibility guidance (this is the single most price-sensitive field, so be specific):",
  "- \"easy\": ground-level windows with clear, unobstructed approach.",
  "- \"moderate\": second-story windows reachable by a standard extension ladder, or ground-level",
  "  windows with minor obstructions (bushes, a narrow side yard).",
  "- \"difficult\": third-story-or-higher windows, windows requiring specialized equipment, locked/",
  "  gated access, steep or unstable ground, dense landscaping blocking approach, or anything else",
  "  that would meaningfully slow the crew down.",
  "If a specific obstruction or access issue drove your accessibility rating, name it in \"warnings\"",
  "as well (e.g. \"Locked side gate blocks access to the rear windows\") — don't let it disappear",
  "into a bare difficulty label the business can't act on.",
  "",
  "Evidence assessment (report this honestly via the \"evidence\" field — real customer photos are",
  "often imperfect, and that's expected, not a failure):",
  "- \"coverage\": \"complete\" if the photos together show every side of the property that matters for",
  "  this job; \"partial\" if some sides/angles are missing; \"insufficient\" if you can't tell how much",
  "  of the property you're even looking at.",
  "- \"overallEvidence\": your holistic judgment. \"sufficient\" — you're confident your counts reflect",
  "  the whole property. \"usable_with_uncertainty\" — you can give a useful partial answer, but you",
  "  know it may be incomplete. \"insufficient\" — you cannot responsibly give the business a number to",
  "  price from; closer or additional photos are genuinely needed.",
  "- \"issues\": name every specific thing that got in the way (\"vegetation\", \"distance\", \"vehicles\",",
  "  \"glare\", \"darkness\", \"blur\", \"cropped_facade\" for a photo that cuts off part of the building,",
  "  \"unrelated_images\" if one or more photos don't appear to show the same property as the others —",
  "  leave it empty if nothing got in the way.",
  "",
  "This is the single most important rule for windowCount, and it was previously stated backwards —",
  "read it carefully: \"windowCount\" answers ONE question — \"how many distinct window openings can",
  "you confidently count in the photos actually provided?\" — never the different question \"what is",
  "this property's total window count?\". Whether the photos show the WHOLE property is a separate",
  "judgment, and it belongs ENTIRELY in \"evidence.coverage\"/\"evidence.overallEvidence\" below — never",
  "folded into windowCount's own status. A single photo showing only one side, or even just one",
  "close-up window with nothing else of the building visible, is completely normal and still fully",
  "answerable: if you can clearly see and count exactly 1 window in it, windowCount IS \"observed\"",
  "with value 1 — that is not a claim the property only has 1 window, only a report of what these",
  "specific photos show, and \"evidence.coverage\": \"partial\" or \"insufficient\" is what tells the",
  "business the total may be higher, not a downgraded windowCount status. The same applies at any",
  "count: if you can clearly count 6 windows across the provided photos, windowCount is \"observed\"",
  "with value 6 REGARDLESS of whether other parts of the property are obscured, too far away, or not",
  "shown at all — say that separately via \"evidence\"/\"warnings\" (e.g. \"Only the front elevation is",
  "visible; the total window count is likely higher\"), never by refusing to report what you did",
  "count. Reserve \"uncertain\" for windowCount specifically for when you cannot even confidently count",
  "what IS visible — the windows themselves are ambiguous, overlapping, or too unclear to pin down a",
  "number — and even then, always attach your best-guess \"value\" rather than omitting it; \"uncertain\"",
  "means \"this number might be off\", never \"no number.\" Reserve \"unknown\" for windowCount only when",
  "the photos genuinely show no windows at all, or nothing interpretable as a building.",
  "",
  "You are not setting a price; you are only describing what is visible.",
].join("\n");

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
 * A safe, server-log-only diagnostic string for an Anthropic `APIError` —
 * its own request id and its own error message (Anthropic's error
 * messages are developer-facing descriptions of what was wrong with the
 * REQUEST, e.g. "not scoped to a workspace" or a schema complaint; they
 * never echo the API key or request content back). Never returned to a
 * customer/business — see `AiProviderError.detail`'s own comment.
 */
function safeDetail(err: APIError): string {
  const parts = [`status=${err.status ?? "unknown"}`];
  if (err.requestID) parts.push(`requestId=${err.requestID}`);
  if (err.message) parts.push(`message=${err.message}`);
  return parts.join(" ");
}

/**
 * Maps SDK-level failures to a small set of clear, non-leaking, categorized
 * errors — never a raw provider error string (which could echo request
 * details) and never the API key. The category (Phase 12 — see
 * docs/decisions/0014-ai-real-world-refinement.md) drives both dev logging
 * and which of the distinct failure messages section 13 of the brief asks
 * for actually reaches the UI. Every `APIError` branch also attaches
 * `detail` (see `safeDetail` above) so a server log can distinguish WHICH
 * specific problem produced a given category, rather than every instance
 * of e.g. "invalid-request" looking identical in logs.
 */
function describeFailure(err: unknown): AiProviderError {
  if (err instanceof Anthropic.AuthenticationError) {
    return new AiProviderError("The AI provider rejected the configured credentials.", "authentication", safeDetail(err));
  }
  // Checked before the generic APIError fallback, using Anthropic's own
  // documented `error.type` values (see @anthropic-ai/sdk's
  // resources/shared.d.ts ErrorType union) — these are otherwise
  // indistinguishable from any other 4xx/5xx and previously all collapsed
  // into the same generic "provider-error" category.
  if (err instanceof Anthropic.APIError && err.type === "not_found_error") {
    return new AiProviderError(
      "The AI provider doesn't recognize the configured model. This needs attention from Tallyvis, not a retry.",
      "model-not-found",
      safeDetail(err),
    );
  }
  if (err instanceof Anthropic.APIError && err.type === "billing_error") {
    return new AiProviderError(
      "The AI provider account needs billing attention. This needs attention from Tallyvis, not a retry.",
      "billing",
      safeDetail(err),
    );
  }
  if (err instanceof Anthropic.APIError && err.type === "overloaded_error") {
    return new AiProviderError("The AI provider is temporarily at capacity. Please try again shortly.", "overloaded", safeDetail(err));
  }
  // Confirmed in production (2026-09-23): an API key not scoped to a
  // workspace makes every request fail this way — a genuine account/key
  // configuration problem on Anthropic's side, not a per-request or
  // per-photo issue, and previously indistinguishable from any other 4xx
  // in the generic "provider-error" bucket below. `detail` (server-log-only,
  // never customer-facing) now carries Anthropic's own message/request id
  // so a recurrence can be diagnosed without guessing.
  if (err instanceof Anthropic.APIError && err.type === "invalid_request_error") {
    return new AiProviderError(
      "AI analysis isn't configured correctly for this environment yet.",
      "invalid-request",
      safeDetail(err),
    );
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AiProviderError("The AI provider is rate-limiting requests right now. Please try again shortly.", "rate-limit", safeDetail(err));
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new AiProviderError("The AI provider did not respond in time.", "timeout");
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new AiProviderError("Could not reach the AI provider.", "connection");
  }
  if (err instanceof Anthropic.APIError) {
    return new AiProviderError(`The AI provider returned an error (status ${err.status ?? "unknown"}).`, "provider-error", safeDetail(err));
  }
  return new AiProviderError("The AI provider request failed.", "provider-error");
}

export function createAnthropicProvider(config: AnthropicProviderConfig): AiProvider {
  if (!config.apiKey) {
    throw new AiProviderError("AI analysis is not configured for this environment.", "not-configured");
  }

  const client = new Anthropic({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    timeout: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
  const model = config.model ?? DEFAULT_MODEL;

  async function analyzeProperty(images: PropertyImage[], metadata: PropertyMetadata): Promise<AiProviderResult> {
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
      throw describeFailure(err);
    }

    // `_request_id` is added by the SDK itself onto every successfully
    // parsed response (see @anthropic-ai/sdk's `WithRequestID`) — safe to
    // read directly, no `.withResponse()` needed, and the same identifier
    // Anthropic's own support asks for when diagnosing a specific call.
    const requestId = (response as Anthropic.Message & { _request_id?: string | null })._request_id ?? undefined;
    const diagnosticDetail = `requestId=${requestId ?? "unknown"} stopReason=${response.stop_reason ?? "unknown"}`;

    const meta = {
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      requestId,
      stopReason: response.stop_reason,
    };

    if (response.stop_reason === "refusal") {
      throw new AiProviderError("The AI declined to analyze these photos.", "refusal", diagnosticDetail);
    }

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === TOOL_NAME,
    );
    if (!toolUse) {
      throw new AiProviderError(
        "The AI did not return a structured result.",
        "malformed-response",
        `${diagnosticDetail} toolUseFound=false`,
      );
    }

    // `toolUse.input` is already JSON-parsed by the SDK for a non-streaming
    // response — still `unknown` from this file's point of view, and still
    // subject to `validateRawPropertyObservation` by the caller before
    // anything trusts its shape.
    return { raw: toolUse.input, meta: { ...meta, toolUseFound: true } };
  }

  return { name: "anthropic", model, analyzeProperty };
}
