import type { AccessibilityLevel, ConditionLevel, ConfidenceLevel, WindowType } from "@tallyvis/types";

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
 * Vision V1.1 (docs/decisions/0023-guided-capture-evidence-confidence.md) —
 * how much of the property the submitted photos actually show, distinct
 * from how confident the model is about any one field. A model can be
 * "observed, high confidence" about a windowCount of 6 while still
 * knowing perfectly well that 6 is only what's visible, not necessarily
 * the property's true total — `coverage`/`overallEvidence` is what lets
 * `reconcile.ts` and the UI tell "the AI is sure of what it saw" apart
 * from "the AI saw enough of the property to be sure of the total."
 *
 * `coverage` is the specific diagnostic dimension (how much of the
 * property's sides/angles came through) — mainly useful for composing a
 * specific follow-up message. `overallEvidence` is the single field code
 * actually branches on (reconciliation's defensive downgrade, the
 * follow-up-photo prompt, quote escalation) — the model's own holistic
 * judgment combining coverage, visibility, distance, and any issues below
 * into one of three actionable tiers. `issues` is a flat set of specific,
 * named problems (not a free-text field) so a follow-up message can name
 * the actual obstacle instead of a generic "photos weren't good enough."
 * Deliberately no separate `distance`/`visibility` scalar fields — an
 * issue tag already conveys that same information per photo without a
 * second parallel classification to keep in sync with it.
 */
export type EvidenceCoverage = "complete" | "partial" | "insufficient";
export type OverallEvidence = "sufficient" | "usable_with_uncertainty" | "insufficient";
export type EvidenceIssue =
  | "distance"
  | "vegetation"
  | "vehicles"
  | "glare"
  | "darkness"
  | "blur"
  | "cropped_facade"
  | "unrelated_images";

export interface EvidenceAssessment {
  coverage: EvidenceCoverage;
  overallEvidence: OverallEvidence;
  /** Empty when nothing got in the way — never omitted, so a caller never has to special-case "field absent" vs. "no issues found." */
  issues: EvidenceIssue[];
}

/**
 * The validated, structured result of one property-photo analysis pass —
 * what every provider (mock or real) must produce, and the only shape
 * `reconcile.ts` accepts. Field names deliberately mirror
 * `WindowCleaningCharacteristics` one-for-one so the reconciliation step
 * (and the review UI) never has to remember two different names for the
 * same concept; `overallConfidence`/`warnings` are the analysis-level
 * counterparts to `PropertyAnalysisResult`'s `AnalysisMetadata`.
 *
 * Phase 11 originally also asked the model to observe `propertyType`.
 * Phase 12's review (docs/decisions/0014-ai-real-world-refinement.md)
 * found it was never actually read anywhere — `reconcileObservation`
 * doesn't produce a `propertyType` (that belongs to `Property`, collected
 * directly from a human, not inferred from a photo), and the review UI
 * never displayed it. It's removed rather than left as a schema field the
 * model dutifully fills in for nothing — exactly the "added because
 * computer vision can detect it" mistake this phase's brief warns against.
 */
export interface RawPropertyObservation {
  vertical: "window-cleaning";
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
  /** Vision V1.1 — see `EvidenceAssessment`'s own comment above. */
  evidence: EvidenceAssessment;
}
