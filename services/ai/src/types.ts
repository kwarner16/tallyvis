import type {
  AccessibilityLevel,
  ConditionLevel,
  ConfidenceLevel,
  PropertyType,
  WindowType,
} from "@tallyvis/types";

/**
 * Phase 11 — AI estimation intelligence & property analysis foundation. See
 * docs/decisions/0013-ai-analysis-foundation.md.
 *
 * These types are this package's own internal/output contract — distinct
 * from `packages/types`' `WindowCleaningCharacteristics`/
 * `PropertyAnalysisResult`, which is the stable, provider-agnostic shape
 * the rest of the app (and `packages/pricing`) already depends on and which
 * this package still produces at the end of its pipeline (see
 * `reconcile.ts`). `RawPropertyObservation` only exists on this side of
 * that boundary — nothing in `packages/pricing` or `packages/types` needs
 * to know it exists.
 */

/**
 * A single AI-observed value, explicit about how much the model actually
 * saw: enough to commit to a concrete value, enough to guess with
 * acknowledged uncertainty, or nothing usable at all. There is no fourth
 * option where a value is present without a confidence, or where the
 * model is allowed to state a number it isn't prepared to stand behind —
 * "unknown" is always available and always the honest answer when a photo
 * genuinely doesn't show something.
 */
export type ObservedValue<T> =
  | { status: "observed"; value: T; confidence: ConfidenceLevel }
  | { status: "uncertain"; confidence: ConfidenceLevel }
  | { status: "unknown" };

/**
 * The validated, structured result of one property-photo analysis pass —
 * what every provider (mock or real) must produce, and the only shape
 * `reconcile.ts` accepts. Field names deliberately mirror
 * `WindowCleaningCharacteristics` one-for-one so the reconciliation step
 * (and the review UI) never has to remember two different names for the
 * same concept; `overallConfidence`/`warnings` are the analysis-level
 * counterparts to `PropertyAnalysisResult`'s `AnalysisMetadata`.
 */
export interface RawPropertyObservation {
  vertical: "window-cleaning";
  propertyType: ObservedValue<PropertyType>;
  stories: ObservedValue<number>;
  windowCount: ObservedValue<number>;
  windowType: ObservedValue<WindowType>;
  screens: ObservedValue<number>;
  tracks: ObservedValue<number>;
  accessibility: ObservedValue<AccessibilityLevel>;
  condition: ObservedValue<ConditionLevel>;
  hardWaterStaining: ObservedValue<boolean>;
  /** The model's own summary judgment of how much it could confidently determine overall — not simply an average of the per-field confidences above. */
  overallConfidence: ConfidenceLevel;
  /** Free-text caveats a provider wants surfaced verbatim (e.g. "the rear of the property is not visible in any photo"). Bounded in `validateObservation.ts` — never trusted as HTML/markup. */
  warnings: string[];
}
