"use client";

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { AnalysisOverlay, PropertyPhoto } from "@tallyvis/ui";
import { DEMO_WINDOW_DETECTIONS } from "./data";

export interface PropertyComparisonProps {
  revealedDetectionIds: Set<string>;
  revealStoryMarker: boolean;
  running: boolean;
}

/**
 * Draggable before/after comparison: "Original" underneath, "Tallyvis
 * Analysis" on top, clipped to the divider position. Works with mouse,
 * touch (via Pointer Events), and keyboard (arrow keys / Home / End on the
 * focused handle).
 */
export function PropertyComparison({
  revealedDetectionIds,
  revealStoryMarker,
  running,
}: PropertyComparisonProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [position, setPosition] = useState(50);

  const updateFromClientX = useCallback((clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const next = ((clientX - rect.left) / rect.width) * 100;
    setPosition(Math.min(100, Math.max(0, next)));
  }, []);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromClientX(event.clientX);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    updateFromClientX(event.clientX);
  }

  function stopDragging() {
    draggingRef.current = false;
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    const step = event.shiftKey ? 20 : 5;
    if (event.key === "ArrowLeft") {
      setPosition((p) => Math.max(0, p - step));
      event.preventDefault();
    } else if (event.key === "ArrowRight") {
      setPosition((p) => Math.min(100, p + step));
      event.preventDefault();
    } else if (event.key === "Home") {
      setPosition(0);
      event.preventDefault();
    } else if (event.key === "End") {
      setPosition(100);
      event.preventDefault();
    }
  }

  return (
    <div
      ref={containerRef}
      className="relative aspect-[640/440] w-full touch-none select-none overflow-hidden rounded-2xl border border-line bg-paper-alt"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
    >
      <PropertyPhoto className="absolute inset-0 h-full w-full" title="Original property photo" />

      <div
        className="absolute inset-0 h-full w-full"
        style={{ clipPath: `inset(0 0 0 ${position}%)` }}
      >
        <PropertyPhoto
          className="absolute inset-0 h-full w-full"
          title="Property photo with Tallyvis analysis overlay"
        />
        <AnalysisOverlay
          detections={DEMO_WINDOW_DETECTIONS}
          revealedDetectionIds={revealedDetectionIds}
          revealStoryMarker={revealStoryMarker}
          running={running}
        />
      </div>

      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 w-px bg-paper"
        style={{ left: `${position}%` }}
      />

      <div
        role="slider"
        tabIndex={0}
        aria-label="Comparison position between the original photo and the Tallyvis analysis"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(position)}
        aria-valuetext={`${Math.round(position)}% analysis revealed`}
        onKeyDown={handleKeyDown}
        className="absolute top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full border-2 border-accent bg-paper shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong focus-visible:ring-offset-2"
        style={{ left: `${position}%` }}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="h-4 w-4 text-accent-strong"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7l-4 5 4 5M16 7l4 5-4 5" />
        </svg>
      </div>

      <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-ink/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-paper">
        Original
      </span>
      <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-accent-strong px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-paper">
        Tallyvis Analysis
      </span>
    </div>
  );
}
