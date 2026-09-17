import { STORY_LINE_Y, VIEW_HEIGHT, VIEW_WIDTH, WALL } from "../houseGeometry";
import { DEMO_WINDOW_DETECTIONS } from "./data";
import type { WindowDetection } from "./types";

function pct(value: number, axis: "x" | "y") {
  return (value / (axis === "x" ? VIEW_WIDTH : VIEW_HEIGHT)) * 100;
}

function DetectionBox({ detection }: { detection: WindowDetection }) {
  const outset = 6;
  const { x, y, width, height } = detection.boundingBox;
  const box = {
    x: x - outset,
    y: y - outset,
    width: width + outset * 2,
    height: height + outset * 2,
  };
  const arm = 12;
  const corners = [
    { cx: box.x, cy: box.y, dx: 1, dy: 1 },
    { cx: box.x + box.width, cy: box.y, dx: -1, dy: 1 },
    { cx: box.x, cy: box.y + box.height, dx: 1, dy: -1 },
    { cx: box.x + box.width, cy: box.y + box.height, dx: -1, dy: -1 },
  ];

  return (
    <g style={{ animation: "fade-in 0.35s ease-out" }}>
      <rect
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        fill="none"
        className="stroke-accent"
        strokeWidth={1.5}
      />
      <g className="stroke-accent" strokeWidth={2.25} strokeLinecap="round">
        {corners.map((c, i) => (
          <g key={i}>
            <line x1={c.cx} y1={c.cy} x2={c.cx + arm * c.dx} y2={c.cy} />
            <line x1={c.cx} y1={c.cy} x2={c.cx} y2={c.cy + arm * c.dy} />
          </g>
        ))}
      </g>
    </g>
  );
}

export interface AnalysisOverlayProps {
  revealedDetectionIds: Set<string>;
  revealStoryMarker: boolean;
  /** Whether the scan-line sweep should render (only true while the sequence is actively running). */
  running: boolean;
}

/**
 * The computer-vision annotation layer drawn over the "Tallyvis Analysis"
 * side of the comparison. Purely presentational — driven entirely by the
 * reveal state the orchestrator computes from ANALYSIS_STEPS.
 */
export function AnalysisOverlay({
  revealedDetectionIds,
  revealStoryMarker,
  running,
}: AnalysisOverlayProps) {
  const visibleDetections = DEMO_WINDOW_DETECTIONS.filter((d) => revealedDetectionIds.has(d.id));

  return (
    <div className="pointer-events-none absolute inset-0 h-full w-full">
      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        className="absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        {revealStoryMarker ? (
          <g style={{ animation: "fade-in 0.35s ease-out" }}>
            <line
              x1={WALL.x}
              y1={STORY_LINE_Y}
              x2={WALL.x + WALL.width}
              y2={STORY_LINE_Y}
              className="stroke-accent"
              strokeWidth={1}
              strokeDasharray="5 5"
              opacity={0.7}
            />
          </g>
        ) : null}

        {visibleDetections.map((d) => (
          <DetectionBox key={d.id} detection={d} />
        ))}

        {running ? (
          <rect
            x={40}
            y={0}
            width={VIEW_WIDTH - 80}
            height={2.5}
            className="fill-accent"
            opacity={0.85}
            style={{ animation: "scan-once 2.6s ease-in-out 1 forwards" }}
          />
        ) : null}
      </svg>

      {revealStoryMarker ? (
        <span
          className="absolute rounded bg-ink px-1.5 py-0.5 text-[10px] font-medium text-paper"
          style={{
            left: `${pct(WALL.x, "x")}%`,
            top: `${pct(STORY_LINE_Y, "y")}%`,
            transform: "translate(-2px, -130%)",
            animation: "fade-in 0.35s ease-out",
          }}
        >
          Level 02
        </span>
      ) : null}

      {visibleDetections.map((d) => {
        const { x, y, height } = d.boundingBox;
        return (
          <span
            key={`${d.id}-label`}
            className="absolute hidden rounded border border-accent/40 bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent-strong sm:inline-block"
            style={{
              left: `${pct(x, "x")}%`,
              top: `${pct(y + height, "y")}%`,
              transform: "translateY(6px)",
              animation: "fade-in 0.35s ease-out",
            }}
          >
            Double-hung &middot; {Math.round(d.confidence * 100)}%
          </span>
        );
      })}
    </div>
  );
}
