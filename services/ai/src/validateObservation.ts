import type {
  AccessibilityLevel,
  ConditionLevel,
  ConfidenceLevel,
  PropertyType,
  WindowType,
} from "@tallyvis/types";
import type { ObservedValue, RawPropertyObservation } from "./types";

/**
 * Every provider's raw output — whether it's the mock's own object literal
 * or a real model's tool-call input parsed from JSON text — is untrusted
 * external data until it passes through here. Nothing downstream
 * (`reconcile.ts`, `packages/pricing`) is allowed to see a
 * `RawPropertyObservation` that didn't come from a successful
 * `validateRawPropertyObservation()` call. See
 * docs/decisions/0013-ai-analysis-foundation.md.
 */

export type ValidationResult =
  | { ok: true; value: RawPropertyObservation }
  | { ok: false; errors: string[] };

const CONFIDENCE_LEVELS: readonly ConfidenceLevel[] = ["high", "medium", "low"];
const PROPERTY_TYPES: readonly PropertyType[] = ["single-family", "townhouse", "other"];
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
 */
function validateObservedValue<T>(
  raw: unknown,
  fieldName: string,
  describeValue: (value: unknown) => value is T,
  valueTypeDescription: string,
  errors: string[],
): ObservedValue<T> | undefined {
  if (!isRecord(raw)) {
    errors.push(`"${fieldName}" must be an object.`);
    return undefined;
  }

  const { status, value, confidence } = raw;

  if (status === "unknown") {
    return { status: "unknown" };
  }

  if (status === "uncertain") {
    if (!isOneOf(confidence, CONFIDENCE_LEVELS)) {
      errors.push(`"${fieldName}.confidence" must be one of ${CONFIDENCE_LEVELS.join(", ")} when status is "uncertain".`);
      return undefined;
    }
    return { status: "uncertain", confidence };
  }

  if (status === "observed") {
    if (!describeValue(value)) {
      errors.push(`"${fieldName}.value" is not a valid ${valueTypeDescription}.`);
      return undefined;
    }
    if (!isOneOf(confidence, CONFIDENCE_LEVELS)) {
      errors.push(`"${fieldName}.confidence" must be one of ${CONFIDENCE_LEVELS.join(", ")} when status is "observed".`);
      return undefined;
    }
    return { status: "observed", value, confidence };
  }

  errors.push(`"${fieldName}.status" must be "observed", "uncertain", or "unknown" — got ${JSON.stringify(status)}.`);
  return undefined;
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
 * Rejects malformed shapes, missing fields, invalid enum values, and
 * absurd numbers — never coerces or guesses a value into existing. Extra/
 * unexpected fields on the input are silently ignored (not copied into the
 * result), never trusted.
 */
export function validateRawPropertyObservation(input: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isRecord(input)) {
    return { ok: false, errors: ["Observation must be a JSON object."] };
  }

  if (input.vertical !== "window-cleaning") {
    errors.push(`"vertical" must be "window-cleaning" — got ${JSON.stringify(input.vertical)}.`);
  }

  const propertyType = validateObservedValue<PropertyType>(
    input.propertyType,
    "propertyType",
    (v): v is PropertyType => isOneOf(v, PROPERTY_TYPES),
    `property type (one of ${PROPERTY_TYPES.join(", ")})`,
    errors,
  );

  const stories = validateObservedValue<number>(
    input.stories,
    "stories",
    (v): v is number => isFiniteInteger(v, STORIES_RANGE.min, STORIES_RANGE.max),
    `integer between ${STORIES_RANGE.min} and ${STORIES_RANGE.max}`,
    errors,
  );

  const windowCount = validateObservedValue<number>(
    input.windowCount,
    "windowCount",
    (v): v is number => isFiniteInteger(v, COUNT_RANGE.min, COUNT_RANGE.max),
    `integer between ${COUNT_RANGE.min} and ${COUNT_RANGE.max}`,
    errors,
  );

  const windowType = validateObservedValue<WindowType>(
    input.windowType,
    "windowType",
    (v): v is WindowType => isOneOf(v, WINDOW_TYPES),
    `window type (one of ${WINDOW_TYPES.join(", ")})`,
    errors,
  );

  const screens = validateObservedValue<number>(
    input.screens,
    "screens",
    (v): v is number => isFiniteInteger(v, COUNT_RANGE.min, COUNT_RANGE.max),
    `integer between ${COUNT_RANGE.min} and ${COUNT_RANGE.max}`,
    errors,
  );

  const tracks = validateObservedValue<number>(
    input.tracks,
    "tracks",
    (v): v is number => isFiniteInteger(v, COUNT_RANGE.min, COUNT_RANGE.max),
    `integer between ${COUNT_RANGE.min} and ${COUNT_RANGE.max}`,
    errors,
  );

  const accessibility = validateObservedValue<AccessibilityLevel>(
    input.accessibility,
    "accessibility",
    (v): v is AccessibilityLevel => isOneOf(v, ACCESSIBILITY_LEVELS),
    `accessibility level (one of ${ACCESSIBILITY_LEVELS.join(", ")})`,
    errors,
  );

  const condition = validateObservedValue<ConditionLevel>(
    input.condition,
    "condition",
    (v): v is ConditionLevel => isOneOf(v, CONDITION_LEVELS),
    `condition level (one of ${CONDITION_LEVELS.join(", ")})`,
    errors,
  );

  const hardWaterStaining = validateObservedValue<boolean>(
    input.hardWaterStaining,
    "hardWaterStaining",
    (v): v is boolean => typeof v === "boolean",
    "boolean",
    errors,
  );

  if (!isOneOf(input.overallConfidence, CONFIDENCE_LEVELS)) {
    errors.push(`"overallConfidence" must be one of ${CONFIDENCE_LEVELS.join(", ")}.`);
  }

  let warnings: string[] = [];
  if (input.warnings === undefined) {
    warnings = [];
  } else if (!Array.isArray(input.warnings) || !input.warnings.every((w) => typeof w === "string")) {
    errors.push('"warnings" must be an array of strings.');
  } else if (input.warnings.length > MAX_WARNINGS) {
    errors.push(`"warnings" must contain at most ${MAX_WARNINGS} entries.`);
  } else {
    warnings = (input.warnings as string[]).map((w) => w.slice(0, MAX_WARNING_LENGTH));
  }

  if (
    errors.length > 0 ||
    !propertyType ||
    !stories ||
    !windowCount ||
    !windowType ||
    !screens ||
    !tracks ||
    !accessibility ||
    !condition ||
    !hardWaterStaining ||
    !isOneOf(input.overallConfidence, CONFIDENCE_LEVELS)
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      vertical: "window-cleaning",
      propertyType,
      stories,
      windowCount,
      windowType,
      screens,
      tracks,
      accessibility,
      condition,
      hardWaterStaining,
      overallConfidence: input.overallConfidence,
      warnings,
    },
  };
}
