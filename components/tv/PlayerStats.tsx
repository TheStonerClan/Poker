import { formatChips } from "@/lib/tv/format";
import type { PlayerCounts } from "@/lib/tv/types";

type HeadProps = {
  counts: PlayerCounts;
  /**
   * When true, surface the Add-ons counter alongside Re-Entries. Set this
   * once the add-on break has arrived — before that the column reads zero
   * and clutters the header.
   */
  showAddOns?: boolean;
};

export function PlayerHeader({ counts, showAddOns = false }: HeadProps) {
  return (
    <div
      className={`grid ${showAddOns ? "grid-cols-4" : "grid-cols-3"} gap-x-[clamp(1rem,2vw,2rem)] gap-y-1`}
    >
      <Stat label="Players" value={counts.players.toString()} />
      <Stat label="Entries" value={counts.entries.toString()} />
      <Stat label="Re-Entries" value={counts.reEntries.toString()} />
      {showAddOns ? (
        <Stat label="Add-ons" value={counts.addOns.toString()} />
      ) : null}
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
