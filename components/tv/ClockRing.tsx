import { formatMMSS } from "@/lib/tv/format";

type Props = {
  levelLabel: string;
  remainingSec: number;
  durationSec: number;
  nextBreakSec: number | null;
  paused?: boolean;
};

const TICK_COUNT = 60;
// Internal SVG coordinate space. The viewBox lets the SVG scale to any
// CSS size the parent assigns; tick positions and circle radii live in
// these units regardless of the rendered pixel size.
const VB = 520;
const CENTER = VB / 2;
const RING_RADIUS = CENTER - 16;
const TICK_OUTER = RING_RADIUS - 4;
const TICK_INNER = RING_RADIUS - 18;
const TICK_LONG = RING_RADIUS - 26;
const CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * Tournament timer ring. Sized fluidly by the parent — pick a CSS width
 * (with `aspect-ratio: 1`) and the SVG fills it. The HTML overlay text
 * uses `clamp()` so the digits scale with viewport size without ever
 * blowing past the ring or shrinking past readable on a phone preview.
 */
export default function ClockRing({
  levelLabel,
  remainingSec,
  durationSec,
  nextBreakSec,
  paused = false,
}: Props) {
  const progress =
    durationSec > 0 ? Math.max(0, Math.min(1, remainingSec / durationSec)) : 0;
  const dashOffset = CIRCUMFERENCE * (1 - progress);

  return (
    <div className="relative aspect-square w-[clamp(16rem,55vmin,32rem)]">
      <svg
        viewBox={`0 0 ${VB} ${VB}`}
        width="100%"
        height="100%"
        className="block"
      >
        <defs>
          <radialGradient id="clock-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#000000" />
            <stop offset="80%" stopColor="#000000" />
            <stop offset="100%" stopColor="#1a1300" />
          </radialGradient>
        </defs>

        <circle cx={CENTER} cy={CENTER} r={RING_RADIUS} fill="url(#clock-glow)" />

        <circle
          cx={CENTER}
          cy={CENTER}
          r={RING_RADIUS}
          fill="none"
          stroke="var(--color-gold)"
          strokeOpacity={0.35}
          strokeWidth={3}
        />

        <circle
          cx={CENTER}
          cy={CENTER}
          r={RING_RADIUS}
          fill="none"
          stroke="var(--color-gold-bright)"
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${CENTER} ${CENTER})`}
          style={{ transition: "stroke-dashoffset 0.4s linear" }}
        />

        {Array.from({ length: TICK_COUNT }).map((_, i) => {
          const angle = (i / TICK_COUNT) * 2 * Math.PI - Math.PI / 2;
          const isLong = i % 5 === 0;
          const inner = isLong ? TICK_LONG : TICK_INNER;
          const x1 = CENTER + Math.cos(angle) * inner;
          const y1 = CENTER + Math.sin(angle) * inner;
          const x2 = CENTER + Math.cos(angle) * TICK_OUTER;
          const y2 = CENTER + Math.sin(angle) * TICK_OUTER;
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="var(--color-gold)"
              strokeOpacity={isLong ? 0.85 : 0.45}
              strokeWidth={isLong ? 2 : 1}
            />
          );
        })}
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-label uppercase tracking-[0.4em] text-[clamp(0.85rem,2vmin,1.25rem)] mb-[clamp(0.25rem,0.5vmin,0.75rem)]">
          {levelLabel}
        </span>
        <span className="font-mono text-fg leading-none tabular-nums text-[clamp(2.5rem,11vmin,7rem)]">
          {formatMMSS(remainingSec)}
        </span>
        {paused ? (
          <span className="mt-[clamp(0.5rem,1vmin,0.75rem)] text-danger uppercase tracking-[0.3em] text-[clamp(0.7rem,1.4vmin,0.875rem)]">
            Paused
          </span>
        ) : nextBreakSec != null ? (
          <span className="mt-[clamp(0.5rem,1.2vmin,1rem)] text-label uppercase tracking-[0.25em] text-[clamp(0.7rem,1.3vmin,0.875rem)]">
            Next Break {formatMMSS(nextBreakSec)}
          </span>
        ) : null}
      </div>
    </div>
  );
}
