type Bucket = {
  /** Label rendered under each bar (e.g. level number or category). */
  label: string | number;
  /** Numeric height. Zero = empty slot rendered as a gap. */
  count: number;
};

type Props = {
  buckets: Bucket[];
  /** Optional descriptor of what each bucket represents, shown as the y-axis label. */
  yLabel?: string;
  /** Optional descriptor for the x axis, rendered below the labels. */
  xLabel?: string;
  /** Maximum SVG aspect ratio "width / height" used when sizing. Default 5. */
  aspect?: number;
};

/**
 * Hand-rolled SVG bar chart. Zero dependencies, scales fluidly with its
 * container (uses `viewBox` + `width="100%"`). Designed for the small
 * /admin/history dashboard where pulling in a real chart library would
 * be overkill — if we ever want stacked bars, multiple series, or
 * tooltips, swap to recharts at that point.
 */
export default function HistogramBars({
  buckets,
  yLabel,
  xLabel,
  aspect = 5,
}: Props) {
  if (buckets.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-md border border-dashed border-fg/15 text-xs text-fg/40">
        No data yet.
      </div>
    );
  }

  // viewBox coordinate space — the SVG scales to fit any CSS width via
  // `viewBox` so all internal sizing is in arbitrary units.
  const VB_W = 1000;
  const VB_H = Math.round(VB_W / aspect);

  const padLeft = 60;
  const padRight = 16;
  const padTop = 16;
  const padBottom = 36;

  const innerW = VB_W - padLeft - padRight;
  const innerH = VB_H - padTop - padBottom;

  const maxCount = Math.max(1, ...buckets.map((b) => b.count));
  const barWidth = innerW / buckets.length;
  const barInset = Math.max(2, barWidth * 0.15);

  // Y-axis ticks: 0, max/2, max (rounded to whole if integer).
  const ticks = [0, Math.round(maxCount / 2), maxCount];

  return (
    <div className="rounded-md border border-fg/10 p-3">
      {yLabel ? (
        <p className="mb-1 text-[10px] uppercase tracking-[0.25em] text-fg/55">
          {yLabel}
        </p>
      ) : null}
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        width="100%"
        height="auto"
        preserveAspectRatio="xMidYMid meet"
        className="block"
      >
        {/* y-axis baseline */}
        <line
          x1={padLeft}
          y1={padTop + innerH}
          x2={padLeft + innerW}
          y2={padTop + innerH}
          stroke="rgba(255,255,255,0.18)"
          strokeWidth={1}
        />

        {/* y-axis ticks */}
        {ticks.map((t) => {
          const y = padTop + innerH - (t / maxCount) * innerH;
          return (
            <g key={t}>
              <line
                x1={padLeft - 4}
                y1={y}
                x2={padLeft + innerW}
                y2={y}
                stroke="rgba(255,255,255,0.06)"
                strokeWidth={1}
              />
              <text
                x={padLeft - 8}
                y={y + 4}
                fontSize={14}
                fontFamily="ui-monospace, monospace"
                fill="rgba(255,255,255,0.55)"
                textAnchor="end"
              >
                {t}
              </text>
            </g>
          );
        })}

        {/* bars */}
        {buckets.map((b, i) => {
          const x = padLeft + i * barWidth + barInset;
          const w = barWidth - barInset * 2;
          const h = (b.count / maxCount) * innerH;
          const y = padTop + innerH - h;
          return (
            <g key={`${b.label}-${i}`}>
              {b.count > 0 ? (
                <rect
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  fill="var(--color-gold)"
                  fillOpacity={0.85}
                  rx={2}
                />
              ) : null}
              <text
                x={x + w / 2}
                y={padTop + innerH + 20}
                fontSize={14}
                fontFamily="ui-monospace, monospace"
                fill="rgba(255,255,255,0.65)"
                textAnchor="middle"
              >
                {b.label}
              </text>
              {b.count > 0 ? (
                <text
                  x={x + w / 2}
                  y={y - 4}
                  fontSize={12}
                  fontFamily="ui-monospace, monospace"
                  fill="rgba(255,255,255,0.85)"
                  textAnchor="middle"
                >
                  {b.count}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {xLabel ? (
        <p className="mt-1 text-center text-[10px] uppercase tracking-[0.25em] text-fg/55">
          {xLabel}
        </p>
      ) : null}
    </div>
  );
}
