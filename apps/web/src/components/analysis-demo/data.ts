import type { ConfidenceLevel, WindowCleaningCharacteristics } from "@tallyvis/types";
import { HIGHLIGHT_WINDOW, LOWER_WINDOWS, type WindowDetection } from "@tallyvis/ui";
import type { AnalysisStep } from "./types";

/**
 * ============================== DEMO DATA ==============================
 * Hand-authored to illustrate the product concept on the marketing site.
 * This is NOT live computer-vision output — services/ai's analyzeProperty()
 * is not implemented yet (see docs/architecture, Phase 7/8). DEMO_CHARACTERISTICS
 * is typed exactly as WindowCleaningCharacteristics (packages/types) so that
 * when real analysis exists, it can replace this constant without changing
 * any component below — they already consume the real contract type.
 * =========================================================================
 */
export const DEMO_CHARACTERISTICS: WindowCleaningCharacteristics = {
  vertical: "window-cleaning",
  windowCount: 27,
  windowType: "double-hung",
  paneCount: 0,
  stories: 2,
  screens: 12,
  tracks: 0,
  accessibility: "moderate",
  condition: "fair",
  hardWaterStaining: false,
  estimatedLaborHours: 2.4,
  interiorCleaning: false,
};

export const DEMO_CONFIDENCE: ConfidenceLevel = "medium";

export const DEMO_WINDOW_DETECTIONS: WindowDetection[] = [
  {
    type: "window",
    id: "window-upper-03",
    boundingBox: HIGHLIGHT_WINDOW,
    label: "Double-hung",
    confidence: 0.96,
  },
  {
    type: "window",
    id: "window-lower-01",
    boundingBox: LOWER_WINDOWS[0]!,
    label: "Double-hung",
    confidence: 0.93,
  },
];

export const ANALYSIS_STEPS: AnalysisStep[] = [
  { atMs: 0, status: "Analyzing image..." },
  { atMs: 500, status: "Detecting windows...", revealDetectionIds: ["window-upper-03"] },
  { atMs: 900, status: "Detecting windows...", revealDetectionIds: ["window-lower-01"] },
  { atMs: 1250, status: "27 windows detected", revealCharacteristics: ["windows"] },
  {
    atMs: 1600,
    status: "2 stories detected",
    revealCharacteristics: ["stories"],
    revealStoryMarker: true,
  },
  { atMs: 1950, status: "12 screens detected", revealCharacteristics: ["screens"] },
  { atMs: 2300, status: "Access: Moderate", revealCharacteristics: ["access", "windowType"] },
  { atMs: 2650, status: "Estimated labor: ~2.4 hr", revealCharacteristics: ["labor"] },
  { atMs: 3000, status: "Estimate ready" },
];

export const LAST_STEP_INDEX = ANALYSIS_STEPS.length - 1;
