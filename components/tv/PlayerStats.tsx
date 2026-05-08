import { formatChips } from "@/lib/tv/format";
import type { PlayerCounts } from "@/lib/tv/types";

type HeadProps = {
  counts: PlayerCounts;
};

export function PlayerHeader({ counts }: HeadProps) {
  return (
    <div className="grid grid-cols-3 gap-x-8 gap-y-1">
      <Stat label="Players" value={counts.players.toString()} />
      <Stat label="Entries" value={counts.entries.toString()} />
      <Stat label="Re-Entries" value={counts.reEntries.toString()} />
    </div>
  );
}

type StackProps = {
  counts: PlayerCounts;
  bigBlind?: number;
};

export function StackStats({ counts, bigBlind }: StackProps) {
  const bbCount = bigBlind && bigBlind > 0
    ? Math.round(counts.averageChips / bigBlind)
    : null;

  return (
    <div className="flex flex-col gap-2 items-start">
      <Stat label="Total" value={formatChips(counts.totalChips)} />
      <Stat
        label="Average"
        value={formatChips(counts.averageChips)}
        sub={bbCount != null ? `${bbCount} BB` : null}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string | null;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-label uppercase tracking-[0.25em] text-xs">
        {label}
      </span>
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-value text-3xl tabular-nums">
          {value}
        </span>
        {sub ? (
          <span className="font-mono text-label text-sm tabular-nums">
            {sub}
          </span>
        ) : null}
      </div>
    </div>
  );
}
