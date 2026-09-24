import type { AccessibilityLevel, ConditionLevel, ConfidenceLevel, WindowType } from "@tallyvis/types";
import type { ObservedValue, RawPropertyObservation } from "./types";

/**
 * Every provider's raw output — whether it's the mock's own object literal
 * or a real model's tool-call input parsed from JSON text — is untrusted
 * external data until it passes through here. Nothing downstream
 * (`reconcile.ts`, `packages/pricing`) is allowed to see a
 * `RawPropertyObservation` that didn't come from a successful
 * `validateRawPropertyObservation()` call. See
 * docs/decisions/0013-ai-analysis-foundation.md.
 *
 * Phase 12.1 (docs/decisions/0022-graceful-partial-ai-analysis.md) —
 * production diagnosis of a real Anthropic response found this file was
 * previously all-or-nothing: if *any single* per-field observation was
 * malformed (e.g. the model set `status: "observed"` but left off
 * `confidence`), the entire eight-field analysis was discarded, even when
 * every other field was perfectly usable. That's a stricter reliability
 * policy than the product ever intended — `reconcileObservation()` and the
 * review UI (`AiObservationSummary`) already handle individual
 * uncertain/unknown fields gracefully (fall back to a reviewable default,
 * downgrade confidence, show a distinct "not visible" style); they just
 * never got the chance to, because this file rejected the whole response
 * first. Now, a malformed *individual field* degrades to `{status:
 * "unknown"}` (recorded as a warning, never silent) instead of failing the
 * whole observation. Only genuine top-level structural corruption — the
 * input isn't even an object, or the declared vertical doesn't match — is
 * still a hard rejection, since there's no per-field data to salvage from
 * that at all.
 */

export type ValidationResult =
  | { ok: true; value: RawPropertyObservation }
  | { ok: false; errors: string[] };

const CONFIDENCE_LEVELS: readonly ConfidenceLevel[] = ["high", "medium", "low"];
const WINDOW_TYPES: readonly WindowType[] = [
  "single-hung",
  "double-hung",
  "casement",
  "sliding",
  "picture",
  "bay",
  "other",
];
const ACCESSIBILITY_LEVELS: readonly AccessibilityLevel[] = ["easy", "moderate", "difficult"];
const CONDITION_LEVELS: readonly ConditionLevel[] = ["good", "fair", "poor"];

/** Absurd-number guards — generous enough for any real residential property, tight enough to reject a model hallucinating (or a provider bug returning) something like 50,000 windows. */
const STORIES_RANGE = { min: 1, max: 6 };
const COUNT_RANGE = { min: 0, max: 300 }; // windowCount / screens / tracks
const MAX_WARNINGS = 20;
const MAX_WARNING_LENGTH = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function isFiniteInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= min && value <= max;
}

/**
 * Validates one `ObservedValue<T>` field. `describeValue` is the
 * field-specific check for the "observed" case's `value` (an enum
 * membership test, a numeric range test, or a boolean check) — kept as a
 * parameter so every field in `validateRawPropertyObservation` below reads
 * as one line instead of repeating the status/confidence plumbing five times.
 *
 * Never fails the whole observation — a field the provider got wrong in
 * some structural way (missing confidence, an out-of-range value, a typo'd
 * status) degrades to the honest `{status: "unknown"}` rather than voiding
 * every other field alongside it. Every degradation is recorded in
 * `degradations` (merged into the result's `warnings` by the caller) so it
 * stays visible to whoever reviews the analysis, never silent.
 */
function validateObservedValue<T>(
  raw: unknown,
  fieldName: string,
  describeValue: (value: unknown) => value is T,
  valueTypeDescription: string,
  degradations: string[],
): ObservedValue<T> {
  if (!isRecord(raw)) {
    degradations.push(`The AI's "${fieldName}" response wasn't in the expected shape, so it was treated as unknown.`);
    return { status: "unknown" };
  }

  const { status, value, confidence } = raw;

  if (status === "unknown") {
    return { status: "unknown" };
  }

  if (status === "uncertain") {
    if (!isOneOf(confidence, CONFIDENCE_LEVELS)) {
      degradations.push(
        `The AI marked "${fieldName}" uncertain but didn't give a valid confidence level, so it was treated as unknown.`,
      );
      return { status: "unknown" };
    }
    return { status: "uncertain", confidence };
  }

  if (status === "observed") {
    if (!describeValue(value)) {
      degradations.push(
        `The AI's "${fieldName}" value wasn't a valid ${valueTypeDescription}, so it was treated as unknown.`,
      );
      return { status: "unknown" };
    }
    if (!isOneOf(confidence, CONFIDENCE_LEVELS)) {
      degradations.push(
        `The AI observed "${fieldName}" but didn't give a valid confidence level, so it was treated as unknown.`,
      );
      return { status: "unknown" };
    }
    return { status: "observed", value, confidence };
  }

  degradations.push(
    `The AI's "${fieldName}" status was unrecognized (${JSON.stringify(status)}), so it was treated as unknown.`,
  );
  return { status: "unknown" };
}

/**
 * Safely parses a raw JSON string into a plain value, never throwing.
 * Providers that hand back text (rather than an already-parsed object)
 * must go through this before `validateRawPropertyObservation` — a
 * malformed-JSON provider response is a normal, expected failure mode,
 * not a crash.
 */
export function safeParseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Invalid JSON." };
  }
}

/**
 * The single entry point every provider's output must pass through.
 *
 * Two different failure severities, deliberately kept distinct (Phase 12.1
 * — see docs/decisions/0022-graceful-partial-ai-analysis.md):
 *
 * - **Hard rejection** (`ok: false`) — the input isn't even a usable
 *   observation at all: not a JSON object, or a `vertical` that doesn't
 *   match. There's no per-field data worth salvaging from either case, so
 *   the whole thing is discarded and the caller should treat this as a
 *   genuine provider failure (`AiErrorCategory: "invalid-response"`).
 * - **Soft degradation** (still `ok: true`) — any individual field that's
 *   malformed (missing confidence, an invalid enum/number, an unrecognized
 *   status) is replaced with the honest `{status: "unknown"}` and recorded
 *   as a warning. Every other field — and the analysis as a whole — is
 *   still usable. This is what lets a response where the model nailed
 *   `windowCount` and `stories` but fumbled `screens`' confidence field
 *   still reach human review instead of being discarded wholesale.
 *
 * Extra/unexpected top-level fields on the input are silently ignored (not
 * copied into the result), never trusted.
 */
export function validateRawPropertyObservation(input: unknown): ValidationResult {
  if (!isRecord(input)) {
    return { ok: false, errors: ["Observation must be a JSON object."] };
  }

  if (input.vertical !== "window-cleaning") {
    return {
      ok: false,
      errors: [`"vertical" must be "window-cleaning" — got ${JSON.stringify(input.vertical)}.`],
    };
  }

  const degradations: string[] = [];

  const stories = validateObservedValue<number>(
    input.stories,
    "stories",
    (v): v is number => isFiniteInteger(v, STORIES_RANGE.min, STORIES_RANGE.max),
    `integer between ${STORIES_RANGE.min} and ${STORIES_RANGE.max}`,
    degradations,
  );

  const windowCount = validateObservedValue<number>(
    input.windowCount,
    "windowCount",
    (v): v is number => isFiniteInteger(v, COUNT_RANGE.min, COUNT_RANGE.max),
    `integer between ${COUNT_RANGE.min} and ${COUNT_RANGE.max}`,
    degradations,
  );

  const windowType = validateObservedValue<WindowType>(
    input.windowType,
    "windowType",
    (v): v is WindowType => isOneOf(v, WINDOW_TYPES),
    `window type (one of ${WINDOW_TYPES.join(", ")})`,
    degradations,
  );

  const screens = validateObservedValue<number>(
    input.screens,
    "screens",
    (v): v is number => isFiniteInteger(v, COUNT_RANGE.min, COUNT_RANGE.max),
    `integer between ${COUNT_RANGE.min} and ${COUNT_RANGE.max}`,
    degradations,
  );

  const tracks = validateObservedValue<number>(
    input.tracks,
    "tracks",
    (v): v is number => isFiniteInteger(v, COUNT_RANGE.min, COUNT_RANGE.max),
    `integer between ${COUNT_RANGE.min} and ${COUNT_RANGE.max}`,
    degradations,
  );

  const accessibility = validateObservedValue<AccessibilityLevel>(
    input.accessibility,
    "accessibility",
    (v): v is AccessibilityLevel => isOneOf(v, ACCESSIBILITY_LEVELS),
    `accessibility level (one of ${ACCESSIBILITY_LEVELS.join(", ")})`,
    degradations,
  );

  const condition = validateObservedValue<ConditionLevel>(
    input.condition,
    "condition",
    (v): v is ConditionLevel => isOneOf(v, CONDITION_LEVELS),
    `condition level (one of ${CONDITION_LEVELS.join(", ")})`,
    degradations,
  );

  const hardWaterStaining = validateObservedValue<boolean>(
    input.hardWaterStaining,
    "hardWaterStaining",
    (v): v is boolean => typeof v === "boolean",
    "boolean",
    degradations,
  );

  // The model's own top-level confidence claim gets the same soft
  // treatment — `reconcileObservation()`'s `downgradeConfidence` already
  // distrusts an unsupported "high" claim downward based on how many core
  // fields actually came through observed, so a missing/invalid claim here
  // safely defaults to the most conservative "low" rather than voiding the
  // whole response.
  let overallConfidence: ConfidenceLevel;
  if (isOneOf(input.overallConfidence, CONFIDENCE_LEVELS)) {
    overallConfidence = input.overallConfidence;
  } else {
    degradations.push(
      `The AI didn't give a valid "overallConfidence", so it was treated as "low".`,
    );
    overallConfidence = "low";
  }

  let warnings: string[] = [];
  if (Array.isArray(input.warnings)) {
    warnings = input.warnings
      .filter((w): w is string => typeof w === "string")
      .slice(0, MAX_WARNINGS)
      .map((w) => w.slice(0, MAX_WARNING_LENGTH));
  } else if (input.warnings !== undefined) {
    degradations.push(`The AI's "warnings" field wasn't a valid list, so it was ignored.`);
  }

  return {
    ok: true,
    value: {
      vertical: "window-cleaning",
      stories,
      windowCount,
      windowType,
      screens,
      tracks,
      accessibility,
      condition,
      hardWaterStaining,
      overallConfidence,
      warnings: [...warnings, ...degradations],
    },
  };
}

function summarizeField(field: ObservedValue<unknown>): string {
  if (field.status === "observed") return `observed(${JSON.stringify(field.value)},${field.confidence})`;
  if (field.status === "uncertain") return `uncertain(${field.confidence})`;
  return "unknown";
}

/**
 * A safe, compact, dev-log-only structural summary of a validated
 * observation — every field's status/confidence/value (a count, a story
 * number, an enum like "double-hung", a boolean; never a photo, an
 * address, or any other customer-identifying detail) plus how many
 * individual fields were degraded to unknown. Exists so an operator can
 * answer "what did the model actually return, structurally" from a log
 * line alone — see `services/ai/src/logging.ts`'s `AnalysisLogEvent.
 * observationSummary` and docs/decisions/0022-graceful-partial-ai-
 * analysis.md's "safe structural diagnostics" goal.
 */
export function summarizeObservationForLogging(observation: RawPropertyObservation): string {
  const fields = [
    ["stories", observation.stories],
    ["windowCount", observation.windowCount],
    ["windowType", observation.windowType],
    ["screens", observation.screens],
    ["tracks", observation.tracks],
    ["accessibility", observation.accessibility],
    ["condition", observation.condition],
    ["hardWaterStaining", observation.hardWaterStaining],
  ] as const;

  const parts = fields.map(([name, field]) => `${name}=${summarizeField(field)}`);
  parts.push(`overallConfidence=${observation.overallConfidence}`);
  parts.push(`warnings=${observation.warnings.length}`);
  return parts.join(" ");
}
