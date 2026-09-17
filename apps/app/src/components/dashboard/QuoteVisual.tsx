import type { WindowCleaningCharacteristics } from "@tallyvis/types";
import {
  ALL_WINDOW_SLOTS,
  AnalysisOverlay,
  PropertyPhoto,
  type WindowDetection,
} from "@tallyvis/ui";

function formatWindowType(type: string): string {
  return type[0]!.toUpperCase() + type.slice(1).replace("-", " ");
}

/**
 * An illustrative representation of the analysis — NOT drawn from the
 * customer's actual photo. There's no real per-window coordinate data to
 * draw honestly (the mock analyzer only produces aggregate counts), so this
 * deliberately uses the same stylized illustration as the marketing site
 * rather than overlaying fabricated boxes on a real photo, which would
 * misrepresent that detection happened on it. The real submitted photos are
 * shown separately, unannotated.
 */
export function QuoteVisual({
  characteristics,
}: {
  characteristics: WindowCleaningCharacteristics;
}) {
  const slotCount = Math.min(
    ALL_WINDOW_SLOTS.length,
    Math.max(1, characteristics.windowCount > 0 ? 3 : 0),
  );
  const detections: WindowDetection[] = ALL_WINDOW_SLOTS.slice(0, slotCount).map((box, i) => ({
    type: "window",
    id: `slot-${i}`,
    boundingBox: box,
    label: formatWindowType(characteristics.windowType),
    confidence: 0.9 + i * 0.02,
  }));

  return (
    <div className="flex flex-col gap-2">
      <div className="relative overflow-hidden rounded-2xl border border-line bg-paper-alt">
        <PropertyPhoto className="h-full w-full" title="Illustrative property visualization" />
        <AnalysisOverlay
          detections={detections}
          revealedDetectionIds={new Set(detections.map((d) => d.id))}
          revealStoryMarker={characteristics.stories >= 2}
          storyLabel={`Level 0${characteristics.stories}`}
        />
      </div>
      <p className="text-xs text-ink-faint">
        Illustrative visualization — not drawn from the customer&rsquo;s actual photo.
      </p>
    </div>
  );
}
