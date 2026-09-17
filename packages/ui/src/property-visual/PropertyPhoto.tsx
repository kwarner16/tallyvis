import {
  DOOR,
  GROUND_Y,
  LOWER_WINDOWS,
  ROOF_POINTS,
  STORY_LINE_Y,
  UPPER_WINDOWS,
  VIEW_HEIGHT,
  VIEW_WIDTH,
  WALL,
  type BoundingBox,
} from "./houseGeometry";

function WindowGlass({ box }: { box: BoundingBox }) {
  const { x, y, width: w, height: h } = box;
  return (
    <g>
      <rect x={x - 4} y={y - 4} width={w + 8} height={h + 8} rx={2} fill="url(#trimGradient)" />
      <rect x={x} y={y} width={w} height={h} fill="url(#glassGradient)" />
      <line x1={x + w / 2} y1={y} x2={x + w / 2} y2={y + h} stroke="#e9e2d4" strokeWidth={2.5} />
      <line x1={x} y1={y + h / 2} x2={x + w} y2={y + h / 2} stroke="#e9e2d4" strokeWidth={2.5} />
      <rect
        x={x - 4}
        y={y - 4}
        width={w + 8}
        height={h + 8}
        rx={2}
        fill="none"
        stroke="#c9bfa8"
        strokeWidth={1}
      />
    </g>
  );
}

export interface PropertyPhotoProps {
  className?: string;
  title?: string;
}

/**
 * Original stylized SVG property illustration standing in for real
 * architectural photography (no licensed photo assets available — see
 * docs/decisions). Shared by the marketing site (hero, interactive demo) and
 * the business dashboard's illustrative quote visualization so all three use
 * identical geometry and material treatment.
 */
export function PropertyPhoto({
  className,
  title = "Illustrated two-story property facade",
}: PropertyPhotoProps) {
  return (
    <svg
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      className={className}
      role="img"
      aria-label={title}
    >
      <defs>
        <linearGradient id="skyGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f5efe3" />
          <stop offset="100%" stopColor="#f1eadd" />
        </linearGradient>
        <linearGradient id="groundGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e3dac8" />
          <stop offset="100%" stopColor="#d8cdb7" />
        </linearGradient>
        <linearGradient id="roofGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4b4038" />
          <stop offset="100%" stopColor="#332b25" />
        </linearGradient>
        <linearGradient id="wallGradient" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#efe6d6" />
          <stop offset="100%" stopColor="#e2d6c0" />
        </linearGradient>
        <linearGradient id="glassGradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#c9dbe0" />
          <stop offset="55%" stopColor="#eef4f2" />
          <stop offset="100%" stopColor="#aebfc7" />
        </linearGradient>
        <linearGradient id="trimGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fbf8f1" />
          <stop offset="100%" stopColor="#eee5d3" />
        </linearGradient>
        <linearGradient id="doorGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8a5a3b" />
          <stop offset="100%" stopColor="#6d4429" />
        </linearGradient>
        <radialGradient id="shadowGradient" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#00000022" />
          <stop offset="100%" stopColor="#00000000" />
        </radialGradient>
        <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000000" floodOpacity="0.12" />
        </filter>
      </defs>

      <rect x={0} y={0} width={VIEW_WIDTH} height={VIEW_HEIGHT} fill="url(#skyGradient)" />
      <rect
        x={0}
        y={GROUND_Y}
        width={VIEW_WIDTH}
        height={VIEW_HEIGHT - GROUND_Y}
        fill="url(#groundGradient)"
      />
      <ellipse cx={320} cy={GROUND_Y + 4} rx={230} ry={14} fill="url(#shadowGradient)" />

      <g filter="url(#softShadow)">
        <polygon
          points={ROOF_POINTS.map(([x, y]) => `${x},${y}`).join(" ")}
          fill="url(#roofGradient)"
          stroke="#241e19"
          strokeWidth={1}
          strokeLinejoin="round"
        />
        {[0, 1, 2, 3, 4].map((i) => {
          const t = (i + 1) / 6;
          return (
            <line
              key={i}
              x1={320 - (320 - 95) * t}
              y1={60 + (190 - 60) * t}
              x2={320 + (545 - 320) * t}
              y2={60 + (190 - 60) * t}
              stroke="#241e19"
              strokeWidth={0.75}
              opacity={0.35}
            />
          );
        })}

        <rect
          x={WALL.x}
          y={WALL.y}
          width={WALL.width}
          height={WALL.height}
          fill="url(#wallGradient)"
        />
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <line
            key={i}
            x1={WALL.x}
            y1={WALL.y + (WALL.height / 7) * i}
            x2={WALL.x + WALL.width}
            y2={WALL.y + (WALL.height / 7) * i}
            stroke="#00000010"
            strokeWidth={1}
          />
        ))}
        <rect
          x={WALL.x}
          y={WALL.y}
          width={WALL.width}
          height={WALL.height}
          fill="none"
          stroke="#c9bfa8"
          strokeWidth={1.5}
        />

        <line
          x1={WALL.x}
          y1={STORY_LINE_Y}
          x2={WALL.x + WALL.width}
          y2={STORY_LINE_Y}
          stroke="#00000018"
          strokeWidth={2}
        />

        <rect
          x={DOOR.x - 3}
          y={DOOR.y - 3}
          width={DOOR.width + 6}
          height={DOOR.height + 3}
          fill="url(#trimGradient)"
        />
        <rect
          x={DOOR.x}
          y={DOOR.y}
          width={DOOR.width}
          height={DOOR.height}
          fill="url(#doorGradient)"
        />
        <circle cx={DOOR.x + DOOR.width - 8} cy={DOOR.y + DOOR.height / 2} r={1.6} fill="#e9dfc9" />

        {UPPER_WINDOWS.map((box, i) => (
          <WindowGlass key={`u-${i}`} box={box} />
        ))}
        {LOWER_WINDOWS.map((box, i) => (
          <WindowGlass key={`l-${i}`} box={box} />
        ))}
      </g>

      <g opacity={0.5}>
        <ellipse cx={210} cy={GROUND_Y + 14} rx={22} ry={12} fill="#8a9a7a" />
        <ellipse cx={440} cy={GROUND_Y + 14} rx={22} ry={12} fill="#8a9a7a" />
      </g>
    </svg>
  );
}
