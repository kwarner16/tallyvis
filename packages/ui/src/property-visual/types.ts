import type { BoundingBox } from "./houseGeometry";

export interface WindowDetection {
  type: "window";
  id: string;
  boundingBox: BoundingBox;
  /** Display-ready label, e.g. "Double-hung". Caller formats — this component doesn't know about vertical-specific terminology. */
  label: string;
  confidence: number;
}
