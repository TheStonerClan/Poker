import { formatBlinds, formatMMSS } from "@/lib/tv/format";
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
  busted: BustedEntry[];
};

export default function BreakPanel({
  remainingSec,
  level,
  nextLevel,
  busted,
}: Props) {
  const colorUp = level.color_up_chips ?? [];

  return (
    <div className="flex flex-col items-center justify-center text-center px-12 py-10 w-full">
      <span className="text-label uppercase tracking-[0.4em] text-2xl">
        Break
      </span>
      <span className="font-mono text-fg leading-none tabular-nums mt-4 text-[10rem]">
        {formatMMSS(remainingSec)}
      </span>
      <span className="text-label uppercase tracking-[0.3em] text-sm mt-2">
        Remaining
      </span>

      {colorUp.length > 0 ? (
        <div className="mt-8 px-6 py-3 border border-gold/60 rounded-md">
          <span className="text-gold-bright uppercase tracking-[0.3em] text-base">
            Color Up
          </span>
          <span className="ml-3 font-mono text-value text-2xl tabular-nums">
            {colorUp.map((v) => `$${v}`).join(", ")} chips
          </span>
        </div>
      ) : null}

      <div className="mt-10 grid grid-cols-2 gap-12 w-full max-w-3xl">
        <div className="text-left">
          <h3 className="text-label uppercase tracking-[0.25em] text-sm">
            Next Level
          </h3>
          <p className="font-mono text-value text-3xl tabular-nums mt-1">
            {nextLevel
              ? `L${nextLevel.level_num} — ${formatBlinds(
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
                    {b.rebought ? "rebought" : `L${b.level ?? "?"}`}
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
