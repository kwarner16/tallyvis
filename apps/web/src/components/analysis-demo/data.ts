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
/**
 * A small, believable residential job — a single-story home with a normal
 * window count, not the 27-window/2-story showcase this used to be. Sized
 * so the total (via the REAL pricing engine — see PricingBreakdown) lands
 * in a psychologically believable homepage-demo range, not a number that
 * makes a first-time visitor wonder if Tallyvis is only for large jobs.
 * This is the CONFIRMED count — see DEMO_DETECTED_WINDOW_COUNT for what
 * Tallyvis's vision pass actually reports before the customer corrects it.
 */
export const DEMO_CHARACTERISTICS: WindowCleaningCharacteristics = {
  vertical: "window-cleaning",
  windowCount: 8,
  windowType: "double-hung",
  paneCount: 0,
  stories: 1,
  screens: 2,
  tracks: 0,
  accessibility: "easy",
  condition: "good",
  hardWaterStaining: false,
  estimatedLaborHours: 1.3,
  interiorCleaning: false,
};

/**
 * What the vision pass actually detects before customer confirmation — one
 * window under DEMO_CHARACTERISTICS.windowCount, illustrating a real,
 * everyday failure mode (a window partially hidden behind a tree/car/angle)
 * honestly rather than hiding it. See SeeWhatTallyvisSees's confirmation
 * step: the customer corrects 7 -> 8, and the price updates to match —
 * demonstrating that Tallyvis surfaces uncertainty instead of silently
 * guessing, without ever showing a raw confidence score or AI schema.
 */
export const DEMO_DETECTED_WINDOW_COUNT = 7;

/** Confidence before the customer confirms/corrects the flagged count. */
export const DEMO_CONFIDENCE: ConfidenceLevel = "medium";

/** Confidence once the customer has confirmed/corrected — matches the real product's behavior (see docs/decisions/0023-guided-capture-evidence-confidence.md): a customer-confirmed characteristic is no longer "uncertain." */
export const DEMO_CONFIDENCE_CONFIRMED: ConfidenceLevel = "high";

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
  { atMs: 1250, status: "7 windows detected — 1 partially obscured", revealCharacteristics: ["windows"] },
  {
    atMs: 1600,
    status: "1 story detected",
    revealCharacteristics: ["stories"],
    revealStoryMarker: true,
  },
  { atMs: 1950, status: "2 screens detected", revealCharacteristics: ["screens"] },
  { atMs: 2300, status: "Access: Easy", revealCharacteristics: ["access", "windowType"] },
  { atMs: 2650, status: "Estimated labor: ~1.3 hr", revealCharacteristics: ["labor"] },
  { atMs: 3000, status: "Confirm the flagged window count" },
];

export const LAST_STEP_INDEX = ANALYSIS_STEPS.length - 1;
