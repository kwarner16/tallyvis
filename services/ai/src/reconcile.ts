import type {
  AccessibilityLevel,
  ConditionLevel,
  ConfidenceLevel,
  PropertyAnalysisResult,
  PropertyMetadata,
  WindowCleaningCharacteristics,
  WindowType,
} from "@tallyvis/types";
import type { EvidenceAssessment, ObservedValue, RawPropertyObservation } from "./types";

/**
 * Turns a validated `RawPropertyObservation` into the stable
 * `PropertyAnalysisResult` shape the rest of the app already understands
 * — the one and only place uncertainty gets resolved into a concrete
 * number a human can review and `packages/pricing` can eventually price.
 * Every fallback used here is recorded in the returned metadata's `notes`,
 * so "the AI wasn't sure, so this defaulted to X" is always visible to
 * whoever reviews the result, never silent.
 *
 * This function contains NO pricing logic and produces NO dollar amount —
 * see docs/decisions/0013-ai-analysis-foundation.md for why that boundary
 * matters. It only ever emits `JobCharacteristics`, the exact input shape
 * `calculateEstimate()` already accepted before this phase existed.
 */

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolve<T>(
  observed: ObservedValue<T>,
  fallback: T,
  fieldLabel: string,
  notes: string[],
): T {
  if (observed.status === "observed") return observed.value;
  const reason = observed.status === "uncertain" ? "the AI wasn't confident enough to commit to a value" : "the AI could not determine this from the photos";
  notes.push(`${fieldLabel}: ${reason}, so it defaulted to ${JSON.stringify(fallback)} — please review.`);
  return fallback;
}

/** The same three-tier accessibility-from-stories heuristic the Phase 4 mock used, kept as the fallback for when accessibility itself wasn't observed. */
function accessibilityFromStories(stories: number): AccessibilityLevel {
  return stories === 1 ? "easy" : stories === 2 ? "moderate" : "difficult";
}

function laborHoursFor(
  windowCount: number,
  stories: number,
  accessibility: AccessibilityLevel,
): number {
  const accessMultiplier = accessibility === "easy" ? 1 : accessibility === "moderate" ? 1.3 : 1.6;
  return Math.round((windowCount * 0.08 + stories * 0.3) * accessMultiplier * 10) / 10;
}

/**
 * Counts how many of the characteristics that most affect price
 * (`stories`, `windowCount`, `accessibility`) the model was actually
 * willing to commit to. Used only to decide whether the model's own
 * `overallConfidence` claim should be distrusted downward — a provider
 * that says "high confidence" but leaves the fields that matter most as
 * "unknown" doesn't get taken at its word.
 */
function countUnresolved(observation: RawPropertyObservation): number {
  return [observation.stories, observation.windowCount, observation.accessibility].filter(
    (field) => field.status !== "observed",
  ).length;
}

function downgradeConfidence(claimed: ConfidenceLevel, unresolvedCount: number): ConfidenceLevel {
  if (unresolvedCount >= 2) return "low";
  if (unresolvedCount === 1 && claimed === "high") return "medium";
  return claimed;
}

const CONFIDENCE_RANK: Record<ConfidenceLevel, number> = { low: 0, medium: 1, high: 2 };

function moreConservative(a: ConfidenceLevel, b: ConfidenceLevel): ConfidenceLevel {
  return CONFIDENCE_RANK[a] <= CONFIDENCE_RANK[b] ? a : b;
}

/**
 * Vision V1.1 (docs/decisions/0023-guided-capture-evidence-confidence.md)
 * — `overallConfidence`/`countUnresolved` above only ever measure whether
 * the model was willing to COMMIT to a value; they say nothing about
 * whether it could see enough of the property to commit to the right
 * value. A model that's genuinely, consistently confident about a
 * windowCount of 6 while looking at a photo that only shows the front of
 * a townhouse from across the street produces exactly the failure this
 * phase exists to catch: `evidence.overallEvidence` is the model's own
 * coverage signal, applied here independently of its per-field confidence
 * claims, never the more optimistic of the two.
 */
function confidenceFromEvidence(evidence: EvidenceAssessment, claimed: ConfidenceLevel): ConfidenceLevel {
  if (evidence.overallEvidence === "insufficient") return "low";
  if (evidence.overallEvidence === "usable_with_uncertainty" && claimed === "high") return "medium";
  return claimed;
}

export function reconcileObservation(
  observation: RawPropertyObservation,
  metadata: PropertyMetadata,
): PropertyAnalysisResult {
  const notes: string[] = [];

  const rawStories = resolve(observation.stories, clamp(metadata.customerDeclaredStories ?? 1, 1, 3), "Stories", notes);
  const stories = clamp(rawStories, 1, 3);

  const windowCount = resolve(
    observation.windowCount,
    clamp(stories * 6, 4, 40),
    "Window count",
    notes,
  );

  // Defensive, code-enforced backstop for exactly the failure this phase
  // targets: a model that reports windowCount as "observed" (so `resolve`
  // above used its value as-is, no fallback note) while its OWN evidence
  // assessment says coverage was insufficient. The prompt now tells the
  // model never to do this, but a prompt is not a contract — this can
  // never be skipped by a model that ignores the instruction. Never
  // silently invents a bigger number; only makes the honest gap visible.
  if (observation.windowCount.status === "observed" && observation.evidence.overallEvidence === "insufficient") {
    notes.push(
      `Window count: ${observation.windowCount.value} window${observation.windowCount.value === 1 ? "" : "s"} clearly visible, but the photos don't show enough of the property to confirm that's the total — please confirm the full count or add more photos.`,
    );
  }

  const windowType = resolve<WindowType>(observation.windowType, "double-hung", "Window type", notes);

  const accessibility = resolve<AccessibilityLevel>(
    observation.accessibility,
    accessibilityFromStories(stories),
    "Accessibility",
    notes,
  );

  const screens = resolve(observation.screens, Math.round(windowCount * 0.4), "Screens", notes);
  const tracks = resolve(observation.tracks, screens, "Tracks", notes);
  const condition = resolve<ConditionLevel>(observation.condition, "good", "Condition", notes);
  const hardWaterStaining = resolve(observation.hardWaterStaining, false, "Hard-water staining", notes);

  const characteristics: WindowCleaningCharacteristics = {
    vertical: "window-cleaning",
    windowCount,
    windowType,
    paneCount: 0,
    stories,
    screens,
    tracks,
    accessibility,
    condition,
    hardWaterStaining,
    estimatedLaborHours: laborHoursFor(windowCount, stories, accessibility),
    interiorCleaning: false,
  };

  const confidence = moreConservative(
    downgradeConfidence(observation.overallConfidence, countUnresolved(observation)),
    confidenceFromEvidence(observation.evidence, observation.overallConfidence),
  );
  const allNotes = [...observation.warnings, ...notes];

  return {
    characteristics,
    metadata: { confidence, notes: allNotes.length > 0 ? allNotes : undefined },
  };
}
