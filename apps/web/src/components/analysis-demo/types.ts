/**
 * "needs-more-info" is reserved for the low-confidence path described in
 * docs/product (request additional photos rather than guess) — this demo's
 * scripted sequence never reaches it, but the state type accounts for it so
 * a future real-data-driven version isn't designed around an always-happy path.
 */
export type AnalysisStage =
  "idle" | "analyzing" | "analyzed" | "estimate-ready" | "needs-more-info";

export type CharacteristicKey =
  "windows" | "stories" | "screens" | "windowType" | "access" | "labor";

export interface AnalysisStep {
  /** Milliseconds after the sequence starts. */
  atMs: number;
  status: string;
  revealDetectionIds?: string[];
  revealCharacteristics?: CharacteristicKey[];
  revealStoryMarker?: boolean;
}
