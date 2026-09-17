/**
 * Shared coordinate space for the property illustration, used by both the
 * static Hero preview and the interactive "See What Tallyvis Sees" demo so
 * every annotation (boxes, measurements, labels) lines up identically
 * wherever the illustration appears.
 */
export const VIEW_WIDTH = 640;
export const VIEW_HEIGHT = 440;
export const GROUND_Y = 400;

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const ROOF_POINTS: [number, number][] = [
  [320, 60],
  [95, 190],
  [545, 190],
];

export const WALL: BoundingBox = { x: 115, y: 190, width: 410, height: 210 };
export const STORY_LINE_Y = 296;
export const DOOR: BoundingBox = { x: 298, y: 296, width: 44, height: 104 };

export const UPPER_WINDOWS: BoundingBox[] = [
  { x: 150, y: 220, width: 78, height: 66 },
  { x: 268, y: 220, width: 78, height: 66 },
  { x: 386, y: 220, width: 78, height: 66 },
];

export const LOWER_WINDOWS: BoundingBox[] = [
  { x: 150, y: 318, width: 88, height: 66 },
  { x: 398, y: 318, width: 88, height: 66 },
];

/** The window used for the single "highlighted detection" example in both the Hero preview and the demo's first detection. */
export const HIGHLIGHT_WINDOW = UPPER_WINDOWS[2]!;
