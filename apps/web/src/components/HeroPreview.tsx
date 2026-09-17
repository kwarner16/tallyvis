import { HIGHLIGHT_WINDOW, PropertyPhoto, VIEW_HEIGHT, VIEW_WIDTH } from "@tallyvis/ui";

const OUTSET = 6;
const box = {
  x: HIGHLIGHT_WINDOW.x - OUTSET,
  y: HIGHLIGHT_WINDOW.y - OUTSET,
  width: HIGHLIGHT_WINDOW.width + OUTSET * 2,
  height: HIGHLIGHT_WINDOW.height + OUTSET * 2,
};

function pct(value: number, axis: "x" | "y") {
  return (value / (axis === "x" ? VIEW_WIDTH : VIEW_HEIGHT)) * 100;
}

/** Static, non-interactive preview used in the Hero — a lightweight teaser for the full interactive demo below. */
export function HeroPreview() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-line bg-paper-alt">
      <div className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-full border border-line bg-paper/90 px-3 py-1.5 text-xs font-medium text-ink-soft backdrop-blur">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" />
        Property scan
      </div>

      <PropertyPhoto className="h-full w-full" />

      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        <rect
          x={box.x}
          y={box.y}
          width={box.width}
          height={box.height}
          fill="none"
          className="stroke-accent"
          strokeWidth={1.5}
        />
        <rect
          x={40}
          y={0}
          width={VIEW_WIDTH - 80}
          height={2.5}
          className="fill-accent"
          opacity={0.7}
          style={{ animation: "scan 4.5s ease-in-out infinite" }}
        />
      </svg>

      <span
        className="pointer-events-none absolute rounded bg-ink px-1.5 py-0.5 text-[10px] font-medium text-paper"
        style={{
          left: `${pct(box.x, "x")}%`,
          top: `${pct(180, "y")}%`,
          transform: "translateY(-130%)",
        }}
      >
        Level 02
      </span>
      <span
        className="pointer-events-none absolute rounded bg-ink px-1.5 py-0.5 text-[10px] font-medium text-paper"
        style={{
          left: `${pct(box.x + box.width, "x")}%`,
          top: `${pct(box.y + box.height / 2, "y")}%`,
          transform: "translate(10px, -50%)",
        }}
      >
        6.4 ft
      </span>
      <span
        className="pointer-events-none absolute rounded border border-accent/40 bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent-strong"
        style={{
          left: `${pct(box.x, "x")}%`,
          top: `${pct(box.y + box.height, "y")}%`,
          transform: "translateY(6px)",
        }}
      >
        Double-hung
      </span>
    </div>
  );
}
