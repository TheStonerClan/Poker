import { formatMMSS } from "@/lib/tv/format";

type Props = {
  levelLabel: string;
  remainingSec: number;
  durationSec: number;
  nextBreakSec: number | null;
  size?: number;
  paused?: boolean;
};

const TICK_COUNT = 60;

export default function ClockRing({
  levelLabel,
  remainingSec,
  durationSec,
  nextBreakSec,
  size = 520,
  paused = false,
}: Props) {
  const center = size / 2;
  const ringRadius = center - 16;
  const tickOuter = ringRadius - 4;
  const tickInner = ringRadius - 18;
  const tickLong = ringRadius - 26;

  const progress =
    durationSec > 0 ? Math.max(0, Math.min(1, remainingSec / durationSec)) : 0;
  const circumference = 2 * Math.PI * ringRadius;
  const dashOffset = circumference * (1 - progress);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        className="block"
      >
        <defs>
          <radialGradient id="clock-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#000000" />
            <stop offset="80%" stopColor="#000000" />
            <stop offset="100%" stopColor="#1a1300" />
          </radialGradient>
        </defs>

        <circle cx={center} cy={center} r={ringRadius} fill="url(#clock-glow)" />

        <circle
          cx={center}
          cy={center}
          r={ringRadius}
          fill="none"
          stroke="var(--color-gold)"
          strokeOpacity={0.35}
          strokeWidth={3}
        />

        <circle
          cx={center}
          cy={center}
          r={ringRadius}
          fill="none"
          stroke="var(--color-gold-bright)"
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${center} ${center})`}
          style={{ transition: "stroke-dashoffset 0.4s linear" }}
        />

        {Array.from({ length: TICK_COUNT }).map((_, i) => {
          const angle = (i / TICK_COUNT) * 2 * Math.PI - Math.PI / 2;
          const isLong = i % 5 === 0;
          const inner = isLong ? tickLong : tickInner;
          const x1 = center + Math.cos(angle) * inner;
          const y1 = center + Math.sin(angle) * inner;
          const x2 = center + Math.cos(angle) * tickOuter;
          const y2 = center + Math.sin(angle) * tickOuter;
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
        <span className="text-label uppercase tracking-[0.4em] text-xl mb-2">
          {levelLabel}
        </span>
        <span
          className="font-mono text-fg leading-none tabular-nums"
          style={{ fontSize: size * 0.22 }}
        >
          {formatMMSS(remainingSec)}
        </span>
        {paused ? (
          <span className="mt-3 text-danger uppercase tracking-[0.3em] text-sm">
            Paused
          </span>
        ) : nextBreakSec != null ? (
          <span className="mt-4 text-label uppercase tracking-[0.25em] text-sm">
            Next Break {formatMMSS(nextBreakSec)}
          </span>
        ) : null}
      </div>
    </div>
  );
}
