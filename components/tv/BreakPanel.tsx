import { formatBlinds, formatMMSS } from "@/lib/tv/format";
import { formatLevelLabel } from "@/lib/tv/levels";
import type { BlindLevelEntry } from "@/lib/tv/types";

type BustedEntry = {
  name: string;
  level: number | null;
  rebought: boolean;
};

type Props = {
  remainingSec: number;
  level: BlindLevelEntry;
  nextLevel: BlindLevelEntry | null;
  /** Full level list — used to label "L4" / "B2" instead of raw level_num. */
  levels: BlindLevelEntry[];
  busted: BustedEntry[];
};

export default function BreakPanel({
  remainingSec,
  level,
  nextLevel,
  levels,
  busted,
}: Props) {
  const colorUp = level.color_up_chips ?? [];

  return (
    <div className="flex flex-col items-center justify-center text-center px-[clamp(1rem,3vw,3rem)] py-[clamp(1rem,2.5vh,2.5rem)] w-full">
      <span className="text-label uppercase tracking-[0.4em] text-[clamp(1rem,2vw,1.5rem)]">
        Break
      </span>
      <span className="font-mono text-fg leading-none tabular-nums mt-[clamp(0.5rem,1vh,1rem)] text-[clamp(4rem,18vmin,10rem)]">
        {formatMMSS(remainingSec)}
      </span>
      <span className="text-label uppercase tracking-[0.3em] text-[clamp(0.7rem,1vw,0.9rem)] mt-2">
        Remaining
      </span>

      {colorUp.length > 0 ? (
        <div className="mt-[clamp(1rem,2vh,2rem)] px-[clamp(0.75rem,1.5vw,1.5rem)] py-[clamp(0.5rem,1vh,0.75rem)] border border-gold/60 rounded-md">
          <span className="text-gold-bright uppercase tracking-[0.3em] text-[clamp(0.75rem,1.1vw,1rem)]">
            Color Up
          </span>
          <span className="ml-3 font-mono text-value text-[clamp(1rem,1.6vw,1.5rem)] tabular-nums">
            {colorUp.map((v) => `$${v}`).join(", ")} chips
          </span>
        </div>
      ) : null}

      <div className="mt-[clamp(1rem,2.5vh,2.5rem)] grid grid-cols-2 gap-[clamp(1rem,3vw,3rem)] w-full max-w-3xl">
        <div className="text-left">
          <h3 className="text-label uppercase tracking-[0.25em] text-sm">
            Next Level
          </h3>
          <p className="font-mono text-value text-3xl tabular-nums mt-1">
            {nextLevel
              ? `${formatLevelLabel(levels, nextLevel.level_num)} — ${formatBlinds(
                  nextLevel.small,
                  nextLevel.big,
                  nextLevel.ante,
                )}`
              : "—"}
          </p>
        </div>

        <div className="text-left">
          <h3 className="text-label uppercase tracking-[0.25em] text-sm">
            Last Segment
          </h3>
          {busted.length === 0 ? (
            <p className="text-value/60 mt-1">No bust-outs.</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {busted.slice(0, 8).map((b, i) => (
                <li
                  key={`${b.name}-${i}`}
                  className="flex items-baseline justify-between gap-3"
                >
                  <span className="text-value">{b.name}</span>
                  <span className="text-label text-sm">
                    {b.rebought
                      ? "rebought"
                      : b.level != null
                        ? formatLevelLabel(levels, b.level)
                        : "?"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
