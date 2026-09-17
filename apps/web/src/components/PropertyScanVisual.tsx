const VIEW_WIDTH = 640;
const VIEW_HEIGHT = 440;

const UPPER_WINDOWS = [
  { x: 150, y: 220, w: 80, h: 70 },
  { x: 270, y: 220, w: 80, h: 70 },
  { x: 390, y: 220, w: 80, h: 70 },
];

const LOWER_WINDOWS = [
  { x: 150, y: 320, w: 90, h: 70 },
  { x: 400, y: 320, w: 90, h: 70 },
];

const HIGHLIGHT = UPPER_WINDOWS[2]!;

function WindowGlyph({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} className="fill-paper stroke-ink" strokeWidth={1.5} />
      <line
        x1={x + w / 2}
        y1={y}
        x2={x + w / 2}
        y2={y + h}
        className="stroke-ink"
        strokeWidth={1}
        opacity={0.5}
      />
      <line
        x1={x}
        y1={y + h / 2}
        x2={x + w}
        y2={y + h / 2}
        className="stroke-ink"
        strokeWidth={1}
        opacity={0.5}
      />
    </g>
  );
}

function CornerBrackets({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const arm = 14;
  const corners = [
    { cx: x, cy: y, dx: 1, dy: 1 },
    { cx: x + w, cy: y, dx: -1, dy: 1 },
    { cx: x, cy: y + h, dx: 1, dy: -1 },
    { cx: x + w, cy: y + h, dx: -1, dy: -1 },
  ];

  return (
    <g className="stroke-accent" strokeWidth={2.5} strokeLinecap="round">
      {corners.map((c, i) => (
        <g key={i}>
          <line x1={c.cx} y1={c.cy} x2={c.cx + arm * c.dx} y2={c.cy} />
          <line x1={c.cx} y1={c.cy} x2={c.cx} y2={c.cy + arm * c.dy} />
        </g>
      ))}
    </g>
  );
}

export interface PropertyScanVisualProps {
  variant?: "compact" | "full";
  className?: string;
}

/**
 * Original line-illustration standing in for a real property photograph —
 * see docs/decisions for why (no licensed photography available yet). The
 * orange annotations establish the computer-vision detection language used
 * again, with real interactivity, in the Phase 3 demo.
 */
export function PropertyScanVisual({ variant = "compact", className }: PropertyScanVisualProps) {
  const showPanel = variant === "full";
  const outset = 6;
  const box = {
    x: HIGHLIGHT.x - outset,
    y: HIGHLIGHT.y - outset,
    w: HIGHLIGHT.w + outset * 2,
    h: HIGHLIGHT.h + outset * 2,
  };

  return (
    <div
      className={["flex flex-col gap-4 lg:flex-row lg:items-stretch", className]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="relative flex-1 overflow-hidden rounded-2xl border border-line bg-paper-alt">
        <div className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-full border border-line bg-paper/90 px-3 py-1.5 text-xs font-medium text-ink-soft backdrop-blur">
          <span
            aria-hidden="true"
            className={[
              "h-1.5 w-1.5 rounded-full bg-accent",
              showPanel ? "animate-pulse" : "",
            ].join(" ")}
          />
          {showPanel ? "Analyzing property" : "Property scan"}
        </div>

        <svg
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          className="h-full w-full"
          role="img"
          aria-label="Illustration of a house facade with computer-vision detection overlays identifying windows, stories, and access."
        >
          <line x1={40} y1={410} x2={600} y2={410} className="stroke-line" strokeWidth={2} />

          <polygon
            points="320,50 90,190 550,190"
            className="fill-paper stroke-ink"
            strokeWidth={1.5}
            strokeLinejoin="round"
          />

          <rect
            x={110}
            y={190}
            width={420}
            height={220}
            className="fill-paper stroke-ink"
            strokeWidth={1.5}
          />

          <line
            x1={110}
            y1={300}
            x2={530}
            y2={300}
            className="stroke-charcoal-line"
            strokeWidth={1}
            strokeDasharray="4 5"
            opacity={0.5}
          />

          <rect
            x={300}
            y={300}
            width={40}
            height={110}
            className="fill-paper-alt stroke-ink"
            strokeWidth={1.5}
          />

          {UPPER_WINDOWS.map((win, i) => (
            <WindowGlyph key={`u-${i}`} {...win} />
          ))}
          {LOWER_WINDOWS.map((win, i) => (
            <WindowGlyph key={`l-${i}`} {...win} />
          ))}

          <rect
            x={box.x}
            y={box.y}
            width={box.w}
            height={box.h}
            fill="none"
            className="stroke-accent"
            strokeWidth={1.5}
          />
          <CornerBrackets {...box} />

          <line
            x1={box.x + box.w + 22}
            y1={box.y}
            x2={box.x + box.w + 22}
            y2={box.y + box.h}
            className="stroke-accent"
            strokeWidth={1}
          />
          <line
            x1={box.x + box.w + 16}
            y1={box.y}
            x2={box.x + box.w + 28}
            y2={box.y}
            className="stroke-accent"
            strokeWidth={1}
          />
          <line
            x1={box.x + box.w + 16}
            y1={box.y + box.h}
            x2={box.x + box.w + 28}
            y2={box.y + box.h}
            className="stroke-accent"
            strokeWidth={1}
          />

          <g aria-hidden="true">
            <rect
              x={40}
              y={0}
              width={560}
              height={2.5}
              className="fill-accent"
              opacity={0.7}
              style={{
                transformOrigin: "center",
                animation: "scan 4.5s ease-in-out infinite",
              }}
            />
          </g>
        </svg>

        <span
          className="pointer-events-none absolute rounded bg-ink px-1.5 py-0.5 text-[10px] font-medium text-paper"
          style={{
            left: `${((box.x + box.w + 22) / VIEW_WIDTH) * 100}%`,
            top: `${((box.y + box.h / 2) / VIEW_HEIGHT) * 100 - 3}%`,
            transform: "translateX(10px)",
          }}
        >
          6.4 ft
        </span>

        <span
          className="pointer-events-none absolute rounded bg-ink px-1.5 py-0.5 text-[10px] font-medium text-paper"
          style={{
            left: `${(120 / VIEW_WIDTH) * 100}%`,
            top: `${(190 / VIEW_HEIGHT) * 100}%`,
            transform: "translateY(-130%)",
          }}
        >
          Level 02
        </span>

        <span
          className="pointer-events-none absolute rounded border border-accent/40 bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent-strong"
          style={{
            left: `${(box.x / VIEW_WIDTH) * 100}%`,
            top: `${((box.y + box.h) / VIEW_HEIGHT) * 100}%`,
            transform: "translateY(6px)",
          }}
        >
          Double-hung
        </span>
      </div>

      {showPanel ? (
        <div className="flex w-full flex-col justify-center gap-3 rounded-2xl border border-line bg-paper p-6 font-mono text-sm lg:w-64">
          <p className="mb-1 font-sans text-xs font-semibold uppercase tracking-[0.15em] text-ink-faint">
            Detected characteristics
          </p>
          {[
            ["Windows", "27"],
            ["Stories", "2"],
            ["Type", "Double-hung"],
            ["Screens", "12"],
            ["Access", "Moderate"],
          ].map(([label, value]) => (
            <div
              key={label}
              className="flex items-center justify-between border-t border-line pt-3 first:border-t-0 first:pt-0"
            >
              <span className="flex items-center gap-2 text-ink-soft">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-sm bg-accent" />
                {label}
              </span>
              <span className="text-ink">{value}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
