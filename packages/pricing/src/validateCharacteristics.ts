import type {
  AccessibilityLevel,
  ConditionLevel,
  JobCharacteristics,
  PricingValidationResult,
  WindowType,
} from "@tallyvis/types";

/**
 * Defensive validation of the `JobCharacteristics` `calculateEstimate`
 * is about to price — never trusted to have already been checked by a
 * caller. Before Vision V1.1 (docs/decisions/0023-guided-capture-evidence-
 * confidence.md) added a customer-editable confirmation step, the public
 * estimator's characteristics were always machine-produced by
 * `reconcileObservation()`, which already only ever emits sane values. Now
 * a customer's browser sends its own edited copy of `characteristics`
 * across a Server Action boundary — TypeScript's compile-time typing
 * offers no runtime guarantee that JSON actually matches it — so
 * `calculateEstimate`, the one canonical pricing entry point every caller
 * (business dashboard and public estimator alike) already goes through,
 * is the right place to reject an absurd or malformed value before it
 * reaches pricing math, exactly like it already does for the
 * `PricingConfiguration` itself via `validatePricingConfiguration`.
 *
 * Ranges deliberately mirror `services/ai/src/validateObservation.ts`'s
 * own absurd-number guards for the same fields (generous enough for any
 * real residential property, tight enough to reject a client sending
 * something like 50,000 windows) — this file cannot import from
 * `services/ai` (see CLAUDE.md's module boundary rules), so the bounds are
 * duplicated as small local constants rather than shared.
 */

const STORIES_RANGE = { min: 1, max: 6 };
const COUNT_RANGE = { min: 0, max: 300 }; // windowCount / screens / tracks
const PANE_COUNT_RANGE = { min: 0, max: 2000 };
const LABOR_HOURS_RANGE = { min: 0, max: 200 };

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

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function isFiniteNumberInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function isFiniteIntegerInRange(value: unknown, min: number, max: number): value is number {
  return isFiniteNumberInRange(value, min, max) && Number.isInteger(value);
}

function validateWindowCleaningCharacteristics(characteristics: JobCharacteristics): string[] {
  const errors: string[] = [];
  const c = characteristics as unknown as Record<string, unknown>;

  if (!isFiniteIntegerInRange(c.windowCount, COUNT_RANGE.min, COUNT_RANGE.max)) {
    errors.push(`windowCount must be an integer between ${COUNT_RANGE.min} and ${COUNT_RANGE.max}.`);
  }
  if (!isOneOf(c.windowType, WINDOW_TYPES)) {
    errors.push(`windowType must be one of ${WINDOW_TYPES.join(", ")}.`);
  }
  if (!isFiniteIntegerInRange(c.paneCount, PANE_COUNT_RANGE.min, PANE_COUNT_RANGE.max)) {
    errors.push(`paneCount must be an integer between ${PANE_COUNT_RANGE.min} and ${PANE_COUNT_RANGE.max}.`);
  }
  if (!isFiniteIntegerInRange(c.stories, STORIES_RANGE.min, STORIES_RANGE.max)) {
    errors.push(`stories must be an integer between ${STORIES_RANGE.min} and ${STORIES_RANGE.max}.`);
  }
  if (!isFiniteIntegerInRange(c.screens, COUNT_RANGE.min, COUNT_RANGE.max)) {
    errors.push(`screens must be an integer between ${COUNT_RANGE.min} and ${COUNT_RANGE.max}.`);
  }
  if (!isFiniteIntegerInRange(c.tracks, COUNT_RANGE.min, COUNT_RANGE.max)) {
    errors.push(`tracks must be an integer between ${COUNT_RANGE.min} and ${COUNT_RANGE.max}.`);
  }
  if (!isOneOf(c.accessibility, ACCESSIBILITY_LEVELS)) {
    errors.push(`accessibility must be one of ${ACCESSIBILITY_LEVELS.join(", ")}.`);
  }
  if (!isOneOf(c.condition, CONDITION_LEVELS)) {
    errors.push(`condition must be one of ${CONDITION_LEVELS.join(", ")}.`);
  }
  if (typeof c.hardWaterStaining !== "boolean") {
    errors.push("hardWaterStaining must be a boolean.");
  }
  if (!isFiniteNumberInRange(c.estimatedLaborHours, LABOR_HOURS_RANGE.min, LABOR_HOURS_RANGE.max)) {
    errors.push(`estimatedLaborHours must be a number between ${LABOR_HOURS_RANGE.min} and ${LABOR_HOURS_RANGE.max}.`);
  }
  if (typeof c.interiorCleaning !== "boolean") {
    errors.push("interiorCleaning must be a boolean.");
  }

  return errors;
}

/**
 * Validates `characteristics` for whichever vertical it claims to be —
 * today only `"window-cleaning"` exists, mirroring `calculateEstimate`'s
 * own vertical switch. An unrecognized/missing `vertical` is itself a
 * validation error, not a crash.
 */
export function validateCharacteristics(characteristics: JobCharacteristics): PricingValidationResult {
  if (!characteristics || typeof characteristics !== "object") {
    return { valid: false, errors: ["Characteristics must be an object."] };
  }

  switch (characteristics.vertical) {
    case "window-cleaning": {
      const errors = validateWindowCleaningCharacteristics(characteristics);
      return { valid: errors.length === 0, errors };
    }
    default: {
      const errors = [`Unsupported characteristics vertical: ${JSON.stringify((characteristics as { vertical?: unknown }).vertical)}.`];
      return { valid: false, errors };
    }
  }
}
