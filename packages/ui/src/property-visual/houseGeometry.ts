/**
 * Shared coordinate space for the property illustration. Used wherever the
 * illustration appears (marketing site hero/demo, business dashboard quote
 * visualization) so annotations line up identically regardless of caller.
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

/** All drawn window slots, in a stable order — useful for callers that need to assign N detections to N drawn windows. */
export const ALL_WINDOW_SLOTS: BoundingBox[] = [...UPPER_WINDOWS, ...LOWER_WINDOWS];

/** The window used for the single "highlighted detection" example in the Hero preview. */
export const HIGHLIGHT_WINDOW = UPPER_WINDOWS[2]!;
