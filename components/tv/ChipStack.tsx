import type { ChipDenomination } from "@/lib/tv/types";

const CHIP_FILL: Record<string, string> = {
  white: "#f1ece1",
  red: "#cc2e2e",
  blue: "#2c6fbf",
  green: "#2c8b4a",
  black: "#1a1a1a",
  yellow: "#e3c038",
  purple: "#6b3aa0",
  pink: "#cf6a8a",
  orange: "#d97a2c",
  brown: "#5a3722",
  gray: "#7a7a7a",
};

const CHIP_STRIPE: Record<string, string> = {
  white: "#cc2e2e",
  red: "#f1ece1",
  blue: "#f1ece1",
  green: "#f1ece1",
  black: "#cc2e2e",
  yellow: "#1a1a1a",
  purple: "#f1ece1",
  pink: "#1a1a1a",
  orange: "#1a1a1a",
  brown: "#f1ece1",
  gray: "#1a1a1a",
};

type ChipProps = { color: string; size?: number };

function ChipDisc({ color, size = 64 }: ChipProps) {
  const fill = CHIP_FILL[color.toLowerCase()] ?? "#888";
  const stripe = CHIP_STRIPE[color.toLowerCase()] ?? "#fff";
  const r = size / 2;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size * 0.42}>
      <defs>
        <linearGradient id={`chip-shade-${color}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.18)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.5)" />
        </linearGradient>
      </defs>
      <ellipse cx={r} cy={r} rx={r - 1} ry={r * 0.38} fill={fill} stroke="#000" strokeWidth={1} />
      {/* Edge stripes */}
      {[0, 60, 120, 180, 240, 300].map((deg) => {
        const rad = (deg * Math.PI) / 180;
        const x = r + Math.cos(rad) * (r - 5);
        const y = r + Math.sin(rad) * (r * 0.38 - 2);
        return (
          <rect
            key={deg}
            x={x - 4}
            y={y - 3}
            width={8}
            height={6}
            fill={stripe}
            transform={`rotate(${deg} ${x} ${y})`}
          />
        );
      })}
      <ellipse cx={r} cy={r} rx={r * 0.62} ry={r * 0.22} fill={fill} stroke="#000" strokeOpacity={0.4} strokeWidth={0.75} />
      <ellipse cx={r} cy={r} rx={r - 1} ry={r * 0.38} fill={`url(#chip-shade-${color})`} />
    </svg>
  );
}

type Props = {
  denominations: ChipDenomination[];
};

export default function ChipStack({ denominations }: Props) {
  // Stack from highest value at top to lowest at bottom for visual interest.
  const sorted = [...denominations].sort((a, b) => b.value - a.value);

  return (
    <div className="flex flex-col items-start gap-5">
      {sorted.map((d) => (
        <div key={`${d.color}-${d.value}`} className="flex items-center gap-4">
          <div className="relative" style={{ width: 64, height: 36 }}>
            {/* Stack 4 discs to give it visual depth */}
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="absolute left-0"
                style={{ top: 6 + (3 - i) * 4 }}
              >
                <ChipDisc color={d.color} size={64} />
              </div>
            ))}
          </div>
          <span className="font-mono text-value tabular-nums text-2xl">
            ${d.value}
          </span>
        </div>
      ))}
    </div>
  );
}
